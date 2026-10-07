// import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";
// import { Upload } from "@aws-sdk/lib-storage";
// import fs from "fs";
// import path from "path";
// import { envVeriables } from "../config/envConfig";

// const s3Client = new S3Client({
//     region: envVeriables.AWS_REGION,
//     credentials: {
//         accessKeyId: envVeriables.AWS_ACCESS_KEY_ID,
//         secretAccessKey: envVeriables.AWS_SECRET_ACCESS_KEY,
//     },
// });

// /**
//  * Uploads a file to AWS S3 using streaming.
//  * Ideal for large files as it uses multipart upload under the hood.
//  *
//  * @param filePath - The local path to the file
//  * @param folder - The folder in S3 (e.g., 'videos', 'users/profile')
//  * @param mimetype - The mime type of the file
//  * @returns The public URL of the uploaded file
//  */
// export const uploadToS3 = async (
//     filePath: string,
//     folder: string,
//     mimetype: string
// ): Promise<string> => {
//     const fileStream = fs.createReadStream(filePath);
//     const fileName = `${Date.now()}-${path.basename(filePath)}`;
//     const key = `${folder}/${fileName}`;

//     const upload = new Upload({
//         client: s3Client,
//         params: {
//             Bucket: envVeriables.AWS_S3_BUCKET,
//             Key: key,
//             Body: fileStream,
//             ContentType: mimetype,
//             // ACL: 'public-read' // Uncomment if bucket ACLs allow public-read
//         },
//     });

//     await upload.done();

//     // Construct the public URL
//     return `https://${envVeriables.AWS_S3_BUCKET}.s3.${envVeriables.AWS_REGION}.amazonaws.com/${key}`;
// };

// /**
//  * Deletes an object from AWS S3.
//  *
//  * @param fileUrl - The public URL of the file to delete
//  */
// export const deleteFromS3 = async (fileUrl: string): Promise<void> => {
//     try {
//         if (!fileUrl) return;

//         // Example URL: https://bucket-name.s3.region.amazonaws.com/folder/filename.ext
//         const urlObj = new URL(fileUrl);
//         // pathname comes with a leading slash, e.g., '/videos/123-abc.mp4'
//         const key = urlObj.pathname.substring(1);

//         const command = new DeleteObjectCommand({
//             Bucket: envVeriables.AWS_S3_BUCKET,
//             Key: key,
//         });

//         await s3Client.send(command);
//     } catch (error) {
//         console.error("Failed to delete from S3:", error);
//     }
// };
