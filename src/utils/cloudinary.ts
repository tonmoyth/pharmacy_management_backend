import { v2 as cloudinary } from "cloudinary";
import { envVeriables } from "../config/envConfig";
import fs from "fs";

cloudinary.config({
  cloud_name: envVeriables.CLOUDINARY_CLOUD_NAME,
  api_key: envVeriables.CLOUDINARY_API_KEY,
  api_secret: envVeriables.CLOUDINARY_API_SECRET,
});

export const uploadToCloudinary = async (
  localFilePath: string,
  folder: string = "pharmacy-saas"
): Promise<{ url: string; public_id: string } | null> => {
  try {
    if (!localFilePath) return null;
    
    // Upload the file on cloudinary
    const response = await cloudinary.uploader.upload(localFilePath, {
      folder,
      resource_type: "auto",
    });
    
    // File has been uploaded successfull
    if (fs.existsSync(localFilePath)) {
      fs.unlinkSync(localFilePath); // remove the locally saved temporary file
    }
    
    return {
      url: response.secure_url,
      public_id: response.public_id,
    };
  } catch (error) {
    if (fs.existsSync(localFilePath)) {
      fs.unlinkSync(localFilePath); // remove the locally saved temporary file as the upload operation got failed
    }
    return null;
  }
};

export const deleteFromCloudinary = async (publicIdOrUrl: string): Promise<boolean> => {
  try {
    if (!publicIdOrUrl) return false;
    
    let publicId = publicIdOrUrl;
    
    // if url is passed, extract public_id
    if (publicIdOrUrl.startsWith("http")) {
       const urlParts = publicIdOrUrl.split("/");
       const filePart = urlParts[urlParts.length - 1];
       const folderPart = urlParts[urlParts.length - 2];
       const nameWithoutExtension = filePart.split(".")[0];
       publicId = `${folderPart}/${nameWithoutExtension}`;
    }
    
    await cloudinary.uploader.destroy(publicId);
    return true;
  } catch (error) {
    console.error("Error deleting from cloudinary", error);
    return false;
  }
};

export const cloudinaryService = {
  uploadToCloudinary,
  deleteFromCloudinary,
};
