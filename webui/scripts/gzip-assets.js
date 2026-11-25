import { readdir, stat } from 'fs/promises';
import { createGzip } from 'zlib';
import { promisify } from 'util';
import { pipeline } from 'stream';
import { createReadStream, createWriteStream } from 'fs';
import path from 'path';

const pipelineAsync = promisify(pipeline);

const DIST_DIR = 'dist-embed';
const EXTENSIONS_TO_COMPRESS = ['.html', '.js', '.css', '.json', '.svg'];

async function gzipFile(filePath) {
  const basename = path.basename(filePath);
  // Rename index.html.gz to index-app.html.gz
  const gzName = basename === 'index.html' ? 'index-app.html.gz' : basename + '.gz';
  const gzPath = path.join(path.dirname(filePath), gzName);

  await pipelineAsync(
    createReadStream(filePath),
    createGzip({ level: 9 }),
    createWriteStream(gzPath)
  );

  const originalSize = (await stat(filePath)).size;
  const compressedSize = (await stat(gzPath)).size;
  const ratio = ((1 - compressedSize / originalSize) * 100).toFixed(1);

  console.log(`  ${basename} -> ${gzName}: ${originalSize} -> ${compressedSize} bytes (${ratio}% reduction)`);
}

async function processDirectory(dir) {
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      await processDirectory(fullPath);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (EXTENSIONS_TO_COMPRESS.includes(ext)) {
        await gzipFile(fullPath);
      }
    }
  }
}

async function main() {
  console.log('Gzip compressing assets in', DIST_DIR);
  console.log('');

  try {
    await processDirectory(DIST_DIR);
    console.log('');
    console.log('Gzip compression complete!');
  } catch (error) {
    console.error('Error during compression:', error);
    process.exit(1);
  }
}

main();
