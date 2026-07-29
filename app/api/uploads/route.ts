import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import crypto from "crypto";
import sharp from "sharp";

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_SIZE_BYTES = 15 * 1024 * 1024;
const MAX_DIMENSION = 1600;

// Görseli VPS diskine sıkıştırılmış webp olarak kaydeder, Ozon'un çekebileceği tam URL'i döner.
// Disk alanından tasarruf için yeniden boyutlandırma + kalite düşürme yapılıyor.
export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file alanı gerekli" }, { status: 400 });
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json({ error: "Sadece JPEG, PNG veya WEBP kabul edilir" }, { status: 400 });
  }
  if (file.size > MAX_SIZE_BYTES) {
    return NextResponse.json({ error: "Görsel 15MB'tan büyük olamaz" }, { status: 400 });
  }

  await mkdir(UPLOAD_DIR, { recursive: true });
  // JPEG kullanıyoruz çünkü Ozon'un görsel işleyicisi WEBP'i güvenilir şekilde desteklemiyor.
  const filename = `${crypto.randomUUID()}.jpg`;
  const inputBuffer = Buffer.from(await file.arrayBuffer());

  const outputBuffer = await sharp(inputBuffer)
    .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();

  await writeFile(path.join(UPLOAD_DIR, filename), outputBuffer);

  const url = new URL(`/uploads/${filename}`, request.nextUrl.origin).toString();
  return NextResponse.json({ url });
}
