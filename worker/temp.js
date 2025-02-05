const path = require("path");
const ffmpeg = require("fluent-ffmpeg");
const fs = require("fs");
const { Worker } = require("bullmq");
const IORedis = require("ioredis");
const AWS = require('aws-sdk');
require('dotenv').config();
const { S3Client } = require('@aws-sdk/client-s3');
const { Upload } = require("@aws-sdk/lib-storage");

const ffmpegLog = false;

const s3Client = new S3Client({
      region:  process.env.AWS_REGION,
      credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
      sslEnabled: false,
      s3ForcePathStyle: true,
      signatureVersion: 'v4',
    });

console.log("AWS Credentials: ", AWS.config.credentials);

// Initialize Redis connection with required options
const connection = new IORedis({
  maxRetriesPerRequest: null, // Set this explicitly to null
  enableReadyCheck: false, // Optional: Prevent ready checks for faster setup
});

// Create a worker instance
const worker = new Worker("encode-video", handleJob, { connection });

worker.on("failed", (job, err) => {
  console.error(`\tThất bại`);
  console.log(err)
});

worker.on("completed", (job) => {
  console.log(`\tThành công`);
});

// async function handleJob(job) {
//   const { fileName, folderPath } = job.data;
//   console.log(`\tBắt đầu chuyển đổi video: ${fileName}`);
//   let dir =
//     "../uploads/" + path.basename(fileName, path.extname(fileName));
//   const fullPath = path.join(folderPath, fileName);
//   if (!fs.existsSync(dir)) fs.mkdirSync(dir);

//   await new Promise((resolve, reject) => {
//     ffmpeg(fullPath) // cần đảm bảo là máy đã cài đặt ffmpeg trước
//       .addOption("-hls_time", "5")
//       .addOption("-hls_list_size", "0")
//       .addOption("-hls_segment_filename", `${dir}/output%03d.ts`)
//       .output(`${dir}/output.m3u8`)
//       .on("stderr", (d) => ffmpegLog && console.log(`\t${d}`)) // hiển thị log ra console khi ffmpeg hoạt động
//       .on("error", (err) => {
//         console.error(`\tFFmpeg error for ${fileName}:`, err);
//         reject(err);
//       })
//       .on("end", () => {
//         // console.log(`\tFinished converting video: ${fileName}`);
//         resolve();
//       })
//       .run();
//   });
// }

// async function handleJob(job) {
//   const { fileName, folderPath } = job.data;
//   console.log(`\tBắt đầu chuyển đổi video: ${fileName}`);
//   const baseName = path.basename(fileName, path.extname(fileName));
//   const inputPath = path.join(folderPath, fileName);
//   const outputDir = path.resolve("../uploads", baseName);

//   if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);

//   // Define quality levels
//   const qualities = [
//     { name: "360p", resolution: "640x360", bitrate: "800k" },
//     { name: "480p", resolution: "854x480", bitrate: "1400k" },
//     { name: "720p", resolution: "1280x720", bitrate: "2800k" },
//   ];

//   // Store paths to the individual playlists
//   const playlistPaths = [];

//   // Process each quality level
//   for (const quality of qualities) {
//     const qualityDir = path.join(outputDir, quality.name);
//     if (!fs.existsSync(qualityDir)) fs.mkdirSync(qualityDir);

//     const playlistPath = path.join(qualityDir, "output.m3u8");
//     playlistPaths.push({ path: playlistPath, resolution: quality.resolution });

//     await new Promise((resolve, reject) => {
//       ffmpeg(inputPath)
//         .size(quality.resolution)
//         .videoBitrate(quality.bitrate)
//         .addOption("-hls_time", "5")
//         .addOption("-hls_list_size", "0")
//         .addOption("-hls_segment_filename", `${qualityDir}/output%03d.ts`)
//         .output(playlistPath)
//         .on("stderr", (d) => ffmpegLog && console.log(`\t${d}`))
//         .on("error", (err) => {
//           console.error(`\tFFmpeg error for ${fileName} (${quality.name}):`, err);
//           reject(err);
//         })
//         .on("end", () => {
//           console.log(`\tFinished encoding ${quality.name}`);
//           resolve();
//         })
//         .run();
//     });
//   }

//   // Generate master playlist
//   const masterPlaylistPath = path.join(outputDir, "master.m3u8");
//   const masterPlaylistContent = playlistPaths
//     .map(
//       ({ path, resolution }) =>
//         `#EXT-X-STREAM-INF:BANDWIDTH=${getBitrate(resolution)},RESOLUTION=${resolution}\n${path}`
//     )
//     .join("\n");

//   fs.writeFileSync(masterPlaylistPath, `#EXTM3U\n${masterPlaylistContent}`);
//   console.log(`\tMaster playlist created at: ${masterPlaylistPath}`);
// }

// Function to process the video
// Custom base directory for processed videos
const bucketName = process.env.BUCKET_OUTPUT;

async function handleJob(job) {
  const { fileName, folderPath } = job.data;
  console.log(`Starting to process video: ${fileName}`);

  const inputPath = path.join(folderPath, fileName);
  const baseName = path.basename(fileName, path.extname(fileName));
  const outputDir = path.resolve(__dirname, "temp_videos", baseName);

  // Create a temporary local directory for processing
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Define video qualities
  const qualities = [
    { name: "360p", resolution: "640x360", bitrate: "800k" },
    { name: "480p", resolution: "854x480", bitrate: "1400k" },
    { name: "720p", resolution: "1280x720", bitrate: "2800k" },
  ];

  const playlistPaths = [];

  try {
    // Process each quality level
    for (const quality of qualities) {
      const qualityDir = path.join(outputDir, quality.name);
      if (!fs.existsSync(qualityDir)) {
        fs.mkdirSync(qualityDir);
      }

      const playlistPath = path.join(qualityDir, "output.m3u8");
      playlistPaths.push({ path: playlistPath, resolution: quality.resolution });

      await new Promise((resolve, reject) => {
        ffmpeg(inputPath)
          .size(quality.resolution)
          .videoBitrate(quality.bitrate)
          .addOption("-hls_time", "5")
          .addOption("-hls_list_size", "0")
          .addOption("-hls_segment_filename", `${qualityDir}/output%03d.ts`)
          .output(playlistPath)
          .on("error", (err) => {
            console.error(`FFmpeg error for ${fileName} (${quality.name}):`, err);
            reject(err);
          })
          .on("end", () => {
            console.log(`Finished encoding ${quality.name}`);
            resolve();
          })
          .run();
      });
    }

    // Create master playlist
    const masterPlaylistPath = path.join(outputDir, "master.m3u8");
    const masterPlaylistContent = playlistPaths
      .map(
        ({ path, resolution }) =>
          `#EXT-X-STREAM-INF:BANDWIDTH=${getBitrate(resolution)},RESOLUTION=${resolution}\n${path.replace(
            outputDir,
            ""
          )}`
      )
      .join("\n");
    fs.writeFileSync(masterPlaylistPath, `#EXTM3U\n${masterPlaylistContent}`);

    console.log("Master playlist created.");

    // Upload files to S3
    await uploadDirectory(outputDir, `videos/${baseName}`);

    console.log("All files uploaded to S3 successfully.");

    // // Clean up local files
    // async function cleanUpDirectory(dirPath) {
    //   try {
    //     await fs.rm(dirPath, { recursive: true, force: true });
    //     console.log("Local files deleted successfully.");
    //   } catch (err) {
    //     console.error("Error deleting local files:", err);
    //   }
    // }
    
    // // Clean up
    // await cleanUpDirectory(outputDir);
  } catch (err) {
    console.error("Error processing video:", err);
  }
}

// Upload a directory to S3
async function uploadDirectory(localDir, s3BaseKey) {
  const files = fs.readdirSync(localDir);

  for (const file of files) {
    const localFilePath = path.join(localDir, file);
    const s3Key = `${s3BaseKey}/${file}`;

    if (fs.statSync(localFilePath).isDirectory()) {
      // Recursively upload subdirectories
      await uploadDirectory(localFilePath, s3Key);
    } else {
      // Upload individual file
      await uploadFile(localFilePath, bucketName, s3Key);
    }
  }
}

// Upload a single file to S3
async function uploadFile(localFilePath, bucketName, s3Key) {
  const fileStream = fs.createReadStream(localFilePath);
  const uploadParams = {
    Bucket: bucketName,
    Key: s3Key,
    Body: fileStream,
  };

  const upload = new Upload({
    client: s3Client,
    params: uploadParams,
  });

  upload.on("httpUploadProgress", (progress) => {
    console.log(`Uploading ${s3Key}: ${progress.loaded} / ${progress.total}`);
  });

  await upload.done();
  console.log(`Uploaded ${s3Key}`);
}

// Helper function to estimate bitrate (can be adjusted as needed)
function getBitrate(resolution) {
  const map = {
    "640x360": 800000,
    "854x480": 1400000,
    "1280x720": 2800000,
  };
  return map[resolution] || 1000000; // Default bitrate
}

console.log("ffmpeg worker đã sẵn sàng");
