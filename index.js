// Simple Express + Mongoose API for storing leads
import express from 'express';
import serverless from 'serverless-http';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
import multer from 'multer';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

dotenv.config();

// ESM-safe paths (this file is in repo root)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distDir = path.join(__dirname, 'dist');
const distIndex = path.join(distDir, 'index.html');
const distExists = fs.existsSync(distIndex);

// S3 client + bucket
const s3Config = { region: process.env.APP_AWS_REGION };
if (process.env.APP_AWS_ACCESS_KEY_ID && process.env.APP_AWS_SECRET_ACCESS_KEY) {
  s3Config.credentials = {
    accessKeyId: process.env.APP_AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.APP_AWS_SECRET_ACCESS_KEY,
  };
}
const s3 = new S3Client(s3Config);

const S3_BUCKET = process.env.APP_AWS_S3_BUCKET;
if (!S3_BUCKET) {
  console.error('Missing APP_AWS_S3_BUCKET');
}

// Multer (in-memory) + validation
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB/file
  fileFilter: (_req, file, cb) => {
    const okTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
    const ok = okTypes.includes(file.mimetype);
    cb(ok ? null : new Error('Only JPEG/PNG/WEBP/HEIC images are allowed'), ok);
  },
});

const app = express();
app.use(express.json());

// CORS: allow configured origins (comma-separated). If none, reflect origin (true) for dev.
const corsOrigins = process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',').map(s => s.trim()).filter(Boolean) : [];
app.use(cors({
  origin: corsOrigins.length ? corsOrigins : true,
}));

// Connect to MongoDB
// Prefer a direct (non‑SRV) connection string if provided. This avoids DNS SRV lookups which can fail in restricted networks.
const mongoUri = process.env.MONGODB_URI_DIRECT || process.env.MONGODB_URI;
if (!mongoUri) {
  console.error('Missing MONGODB_URI (or MONGODB_URI_DIRECT)');
  process.exit(1);
}

const dbName = process.env.MONGODB_DB || 'Skin-analysis-database';
const collectionName = process.env.MONGODB_COLLECTION || 'Skin-analysis';

mongoose
  .connect(mongoUri, { dbName })
  .then(() => console.log(`MongoDB connected (db: ${dbName}, collection: ${collectionName})`))
  .catch((err) => {
    console.error('MongoDB connection error:', err);
  });

// User/Lead schema with History and Images
const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    age: { type: Number, required: true, min: 1 },
    gender: { type: String, enum: ['male', 'female', 'other'], required: true },
    phone: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    history: { type: Array, default: [] },
    images: [{
      _id: mongoose.Schema.Types.ObjectId,
      originalName: String,
      s3Key: String,
      mimeType: String,
      size: Number,
      context: String,
      createdAt: { type: Date, default: Date.now }
    }],
    lastActiveAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

// We explicitly name the collection to 'Skin-analysis' (or from env)
const User = mongoose.model('User', userSchema, collectionName);

// ImageAsset model - DEPRECATED (kept temporarily for reference)
const ImageAsset = mongoose.model('ImageAsset', new mongoose.Schema({
  originalName: String,
  s3Key: String,
  mimeType: String,
  size: Number,
  userId: String,
  context: String,
}, { timestamps: true }), 'imageassets');

function generateS3Key(originalName) {
  const dot = originalName.lastIndexOf('.');
  const ext = dot >= 0 ? originalName.slice(dot) : '';
  const unique = crypto.randomBytes(16).toString('hex');
  return `uploads/analysis/${Date.now()}-${unique}${ext}`;
}

// Upload images to S3 and save metadata in the User document
app.post('/images', upload.array('images', 5), async (req, res) => {
  try {
    const userId = req.header('x-user-id');
    if (!userId) return res.status(400).json({ message: 'x-user-id header is required to associate images with a user' });

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const files = req.files || [];
    if (!files.length) return res.status(400).json({ message: 'No files uploaded' });

    console.log(`Uploading for user: ${userId} to S3 bucket: ${S3_BUCKET}`);

    const savedMetadata = [];
    for (const file of files) {
      const key = generateS3Key(file.originalname);
      await s3.send(
        new PutObjectCommand({
          Bucket: S3_BUCKET,
          Key: key,
          Body: file.buffer,
          ContentType: file.mimetype,
        })
      );

      const imgData = {
        _id: new mongoose.Types.ObjectId(),
        originalName: file.originalname,
        s3Key: key,
        mimeType: file.mimetype,
        size: file.size,
        context: 'analysis-input',
        createdAt: new Date()
      };

      user.images.push(imgData);
      savedMetadata.push(imgData);
    }

    user.lastActiveAt = new Date();
    await user.save();

    res.status(201).json(savedMetadata);
  } catch (err) {
    console.error('Upload error:', err);
    return res.status(500).json({ message: 'Upload failed', error: err.message });
  }
});

// Get a short-lived signed URL to view an image from the User's document
app.get('/images/:id/signed-url', async (req, res) => {
  try {
    const userId = req.header('x-user-id');
    if (!userId) return res.status(400).json({ message: 'x-user-id header is required' });

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const image = user.images.find(img => img._id.toString() === req.params.id);
    if (!image) return res.status(404).json({ message: 'Image not found in user document' });

    const cmd = new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: image.s3Key,
      ResponseContentType: image.mimeType,
    });
    const url = await getSignedUrl(s3, cmd, { expiresIn: 60 });

    res.json({ url });
  } catch (err) {
    console.error('Signed URL error:', err);
    res.status(500).json({ message: 'Failed to generate URL' });
  }
});

// List images for the current user (from their document)
app.get('/images', async (req, res) => {
  try {
    const userId = req.header('x-user-id');
    if (!userId) return res.status(400).json({ message: 'x-user-id header is required' });

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    res.json(user.images || []);
  } catch (err) {
    console.error('List images error:', err);
    res.status(500).json({ message: 'Failed to list images' });
  }
});

// Delete an image (S3 + metadata) from the User's document
app.delete('/images/:id', async (req, res) => {
  try {
    const userId = req.header('x-user-id');
    if (!userId) return res.status(400).json({ message: 'x-user-id header is required' });

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const imageIndex = user.images.findIndex(img => img._id.toString() === req.params.id);
    if (imageIndex === -1) return res.status(404).json({ message: 'Image not found' });

    const image = user.images[imageIndex];

    // Delete from S3
    try {
      await s3.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: image.s3Key }));
    } catch (s3err) {
      console.warn('S3 delete warning (continuing):', s3err.message);
    }

    // Remove from user's images array
    user.images.splice(imageIndex, 1);
    await user.save();

    res.json({ ok: true });
  } catch (err) {
    console.error('Delete image error:', err);
    res.status(500).json({ message: 'Failed to delete image' });
  }
});

app.get('/', (req, res) => {
  // Serve the React/Vite app for real browser navigations, while keeping the health JSON.
  const wantsHtml =
    typeof req.headers.accept === 'string' &&
    req.headers.accept.toLowerCase().includes('text/html');

  if (distExists && wantsHtml) {
    return res.sendFile(distIndex);
  }
  return res.json({ ok: true });
});

app.post('/leads', async (req, res) => {
  try {
    const { name, age, gender, phone, email } = req.body || {};
    if (!name || !age || !gender || !phone || !email) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const normalizedPhone = phone.trim();

    // Check for existing user by email OR phone
    const existingUser = await User.findOne({
      $or: [
        { email: normalizedEmail },
        { phone: normalizedPhone }
      ]
    });

    if (existingUser) {
      // Name validation: must be essentially the same (case-insensitive)
      if (existingUser.name.toLowerCase() !== name.toLowerCase().trim()) {
        return res.status(400).json({
          message: 'A user with this email or phone already exists with a different name. Please use your registered name.'
        });
      }

      // Update existing user details (age/gender might have changed)
      existingUser.age = age;
      existingUser.gender = gender;
      existingUser.lastActiveAt = new Date();
      await existingUser.save();

      return res.status(200).json({
        id: existingUser._id,
        createdAt: existingUser.createdAt,
        updated: true,
        message: 'Existing user record updated.'
      });
    }

    // Create new user
    const user = await User.create({
      name: name.trim(),
      age,
      gender,
      phone: normalizedPhone,
      email: normalizedEmail
    });

    res.status(201).json({ id: user._id, createdAt: user.createdAt, created: true });
  } catch (err) {
    console.error('Lead processing error:', err);
    if (err?.name === 'ValidationError') {
      return res.status(400).json({ message: 'Validation failed', details: err.errors });
    }
    res.status(500).json({ message: 'Failed to process lead' });
  }
});

// Endpoint to update session history for a user (Consolidated Session Storage)
app.post('/users/:userId/history', async (req, res) => {
  try {
    const { userId } = req.params;
    const sessionData = req.body;

    if (!sessionData || !sessionData.sessionId) {
      return res.status(400).json({ message: 'No valid session data including sessionId provided' });
    }
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Find if this session already exists in the history array
    const existingSessionIndex = user.history.findIndex(s => s.sessionId === sessionData.sessionId);

    if (existingSessionIndex > -1) {
      // Update existing session object (Consolidation)
      user.history[existingSessionIndex] = {
        ...user.history[existingSessionIndex],
        ...sessionData,
        updatedAt: new Date().toISOString()
      };
      // Mark history as modified for Mongoose to detect the deep update
      user.markModified('history');
    } else {
      // New session entry
      user.history.push({
        ...sessionData,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    }

    user.lastActiveAt = new Date();
    await user.save();

    res.json({
      ok: true,
      historyCount: user.history.length,
      action: existingSessionIndex > -1 ? 'updated' : 'created'
    });
  } catch (err) {
    console.error('Update history error:', err);
    res.status(500).json({ message: 'Failed to update user history' });
  }
});

// If Vite built output exists, serve it + use SPA fallback for non-API GET routes.
if (distExists) {
  app.use(express.static(distDir));

  app.get('*', (req, res, next) => {
    // Never intercept API routes
    if (
      req.path.startsWith('/images') ||
      req.path.startsWith('/leads') ||
      req.path.startsWith('/users')
    ) {
      return next();
    }

    // Let asset files (e.g. /assets/*) 404 normally
    if (req.path.includes('.')) {
      return next();
    }

    return res.sendFile(distIndex);
  });
}

const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});

export const handler = serverless(app);