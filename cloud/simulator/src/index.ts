#!/usr/bin/env node

import { program } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { SimulatedDevice } from './device.js';
import { generateSelfSignedCert } from './certificate.js';
import { DeviceSerialSchema } from '@molstem/cloud-shared';

// Crockford's Base32 alphabet (excludes I, L, O, U)
const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * Generate a random device serial number in the format MOLSTEM-{26 base32 chars}
 */
function generateSerial(): string {
  const chars: string[] = [];
  for (let i = 0; i < 26; i++) {
    const idx = Math.floor(Math.random() * CROCKFORD_ALPHABET.length);
    chars.push(CROCKFORD_ALPHABET[idx]);
  }
  return `MOLSTEM-${chars.join('')}`;
}

program
  .name('molstem-sim')
  .description('molstem thermocycler device simulator for cloud backend testing')
  .version('1.0.0');

program
  .command('run')
  .description('Run the device simulator')
  .option('-s, --serial <serial>', 'Device serial number (MOLSTEM-...)')
  .option('-u, --url <url>', 'Cloud URL', 'devices.molstem.com')
  .option('-c, --cert <path>', 'Path to mTLS client certificate', 'certs/generic.crt')
  .option('-k, --key <path>', 'Path to mTLS private key', 'certs/generic.key')
  .option('--device-pub <path>', 'Path to device public key PEM', 'keys/device.pub.pem')
  .option('--device-key <path>', 'Path to device private key PEM', 'keys/device.key.pem')
  .option('--no-reconnect', 'Disable auto-reconnect')
  .option('--reconnect-delay <ms>', 'Reconnect delay in milliseconds', '5000')
  .option('--insecure', 'Skip TLS verification (for local dev with self-signed certs)')
  .action(async (options) => {
    // Generate or validate serial
    let serial = options.serial;
    if (!serial) {
      serial = generateSerial();
      console.log(`Generated serial: ${serial}`);
    } else {
      const result = DeviceSerialSchema.safeParse(serial);
      if (!result.success) {
        console.error(`Invalid serial format: ${serial}`);
        console.error('Expected format: MOLSTEM-{26 Crockford base32 characters}');
        process.exit(1);
      }
    }

    // Check if mTLS cert files exist (have defaults)
    const certExists = fs.existsSync(options.cert);
    const keyExists = fs.existsSync(options.key);
    if (certExists !== keyExists) {
      console.error('Both --cert and --key must exist together');
      process.exit(1);
    }

    // Check if device signing key files exist (have defaults)
    const devicePubExists = fs.existsSync(options.devicePub);
    const deviceKeyExists = fs.existsSync(options.deviceKey);
    if (devicePubExists !== deviceKeyExists) {
      console.error('Both --device-pub and --device-key must exist together');
      process.exit(1);
    }

    // Create device config
    const config = {
      serial,
      cloudUrl: options.url,
      autoReconnect: options.reconnect,
      reconnectDelay: parseInt(options.reconnectDelay, 10),
      insecure: options.insecure || false,
      certificates: certExists
        ? {
            certPath: options.cert,
            keyPath: options.key,
          }
        : undefined,
      deviceKeys: deviceKeyExists
        ? {
            publicKeyPath: options.devicePub,
            privateKeyPath: options.deviceKey,
          }
        : undefined,
    };

    console.log('Starting molstem thermocycler device simulator');
    console.log('=================================');
    console.log(`Serial: ${config.serial}`);
    console.log(`Cloud URL: ${config.cloudUrl}`);
    console.log(`mTLS: ${config.certificates ? 'enabled' : 'disabled'}`);
    console.log(`Device signing: ${config.deviceKeys ? 'enabled' : 'disabled'}`);
    console.log(`Insecure mode: ${config.insecure}`);
    console.log(`Auto-reconnect: ${config.autoReconnect}`);
    console.log('');

    const device = new SimulatedDevice(config);

    // Handle shutdown
    process.on('SIGINT', () => {
      console.log('\nShutting down...');
      device.disconnect();
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      console.log('\nShutting down...');
      device.disconnect();
      process.exit(0);
    });

    try {
      // Register to get enrollment ID
      console.log('Registering device...');
      const registration = await device.register();
      console.log('');
      console.log('========================================');
      if (registration.enrolled) {
        console.log('DEVICE ALREADY ENROLLED (no code needed)');
      } else {
        console.log('ENROLLMENT ID:', registration.enrollment_id);
      }
      console.log('========================================');
      if (!registration.enrolled) console.log('Use this ID to add the device to your account');
      console.log('');

      // Connect to WebSocket
      console.log('Connecting to WebSocket...');
      await device.connect();
      console.log('');
      console.log('Device is now connected and simulating temperature data.');
      console.log('Press Ctrl+C to stop.');
    } catch (error) {
      console.error('Failed to start device:', error);
      process.exit(1);
    }
  });

program
  .command('generate-cert')
  .description('Generate a self-signed certificate for testing')
  .option('-s, --serial <serial>', 'Device serial number (MOLSTEM-...)')
  .option('-o, --output <dir>', 'Output directory', './certs')
  .action(async (options) => {
    // Generate or validate serial
    let serial = options.serial;
    if (!serial) {
      serial = generateSerial();
      console.log(`Generated serial: ${serial}`);
    } else {
      const result = DeviceSerialSchema.safeParse(serial);
      if (!result.success) {
        console.error(`Invalid serial format: ${serial}`);
        console.error('Expected format: MOLSTEM-{26 Crockford base32 characters}');
        process.exit(1);
      }
    }

    // Ensure output directory exists
    const outputDir = path.resolve(options.output);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    try {
      const { certPath, keyPath } = await generateSelfSignedCert(serial, outputDir);
      console.log('');
      console.log('Certificate generated successfully!');
      console.log(`Run simulator with: molstem-sim run --serial ${serial} --cert ${certPath} --key ${keyPath}`);
    } catch (error) {
      console.error('Failed to generate certificate:', error);
      process.exit(1);
    }
  });

program
  .command('generate-serial')
  .description('Generate a random device serial number')
  .action(() => {
    const serial = generateSerial();
    console.log(serial);
  });

program.parse();
