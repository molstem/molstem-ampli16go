#include "esp_flasher.hpp"
#include "esp32c5_stub.hpp"
using namespace esp32c5_stub;

extern "C" {
    #include "drivers/lcd.h"
}

EspFlasher::EspFlasher(UART_HandleTypeDef* uart, Lcd_HandleTypeDef* lcd)
    : uart_(uart)
    , lcd_(lcd)
    , last_error_(nullptr)
    , state_(EspFlashState::IDLE)
    , uart_read_cb_(nullptr)
    , total_size_(0)
    , bytes_received_(0)
    , current_block_seq_(0)
    , block_buf_pos_(0)
    , stub_running_(false)
{
}

void EspFlasher::setUartReadCallback(UartReadCallback read_cb) {
    uart_read_cb_ = read_cb;
}
void EspFlasher::setUartSetBaudrateCallback(UartSetBaudrateCallback set_baudrate_cb) {
    uart_set_baudrate_cb_ = set_baudrate_cb;
}

void EspFlasher::start() {
    state_ = EspFlashState::WAIT_SIZE_HEADER;
    total_size_ = 0;
    bytes_received_ = 0;
    current_block_seq_ = 0;
    block_buf_pos_ = 0;
    last_error_ = nullptr;
    // Note: stub_running_ is NOT reset - initStub() should have set it

    lcd_status("ESP32 Programmer", "Waiting for data...");
}

bool EspFlasher::initStub() {
    stub_running_ = false;
    last_error_ = nullptr;

    lcd_status("ESP32 Init", "Syncing...");

    // Sync with ROM bootloader
    if (!sync()) {
        last_error_ = "Sync failed";
        return false;
    }

    lcd_status("ESP32 Init", "Loading stub...");

    // Upload stub to RAM
    if (!upload_stub()) {
        return false;
    }

    // Wait for stub to be ready
    if (!wait_for_ohai(1000)) {
        return false;
    }

    stub_running_ = true;

    lcd_status("ESP32 Init", "Ready");
    return true;
}

void EspFlasher::setError(const char* error) {
    last_error_ = error;
    state_ = EspFlashState::ERROR;
    lcd_status("Flash FAILED!", error);
}

uint32_t EspFlasher::feedData(const uint8_t* data, uint32_t len) {
    if (state_ == EspFlashState::ERROR || state_ == EspFlashState::DONE) {
        return len;  // Ignore data after completion
    }

    uint32_t pos = 0;

    // State: Waiting for 4-byte size header
    while (state_ == EspFlashState::WAIT_SIZE_HEADER) {
        total_size_ = SLICE0_SIZE + SLICE1_SIZE;

        // Validate size
        if (total_size_ == 0 || total_size_ > 4 * 1024 * 1024) {
            setError("Invalid binary size");
            return len;
        }

        // Stub should already be initialized via initStub()
        if (!stub_running_) {
            setError("Stub not initialized");
            return len;
        }

        lcd_status("ESP32 Init", "Changing baud...");

        // Change to high baud rate
        if (!change_baudrate(3000000)) {
            setError("Baud change failed");
            return len;
        }

        // Transition to erasing
        state_ = EspFlashState::ERASING;
        lcd_status("ESP32 Programmer", "Erasing...");

        if (!flash_begin(SLICE0_SIZE, SLICE0_OFFSET)) {
            setError(last_error_ ? last_error_ : "Erase failed");
            return len;
        }

        // Transition to writing
        state_ = EspFlashState::WRITING;
        lcd_status("ESP32 Programmer", "Writing...");
    }

    // State: Writing data blocks
    // Use 16KB block size when stub is running, 1KB otherwise
    const uint32_t active_block_size = stub_running_ ? STUB_BLOCK_SIZE : ROM_BLOCK_SIZE;

    while (state_ == EspFlashState::WRITING && pos < len) {
        // How much can we add to current block?
        uint32_t space_in_block = active_block_size - block_buf_pos_;
        uint32_t remaining_input = len - pos;
        uint32_t remaining_total = total_size_ - bytes_received_;

        // Don't read more than total size
        uint32_t to_copy = remaining_input;
        if (to_copy > remaining_total) {
            to_copy = remaining_total;
        }
        if (to_copy > space_in_block) {
            to_copy = space_in_block;
        }

        // Never let a block span the slice boundary. SLICE0_SIZE is not a
        // multiple of the block size, so slice 0 ends part-way through a block
        // and has to be flushed early - otherwise bytes_received_ steps over
        // the boundary and the switch to slice 1 never happens.
        if (bytes_received_ < SLICE0_SIZE) {
            uint32_t remaining_slice0 = SLICE0_SIZE - bytes_received_;
            if (to_copy > remaining_slice0) {
                to_copy = remaining_slice0;
            }
        }

        // Copy data to block buffer
        memcpy(&block_buf_[block_buf_pos_], &data[pos], to_copy);
        block_buf_pos_ += to_copy;
        bytes_received_ += to_copy;
        pos += to_copy;

        // Check if block is full, slice 0 just ended, or we've received all data
        bool block_full = (block_buf_pos_ >= active_block_size);
        bool all_received = (bytes_received_ >= total_size_);
        bool slice0_complete = (bytes_received_ == SLICE0_SIZE);

        if (block_full || all_received || slice0_complete) {
            flushCurrentBlock();
            if (state_ == EspFlashState::ERROR) {
                return len - pos;
            }

            // Slice 0 done - close it out and start slice 1 at the app partition
            if (slice0_complete) {
            	if (!flash_finish(false)) {
					setError(last_error_ ? last_error_ : "Finish failed");
					return len - pos;
				}

            	if (!flash_begin(SLICE1_SIZE, SLICE1_OFFSET)) {
					setError(last_error_ ? last_error_ : "Erase failed");
					return len - pos;
				}
                current_block_seq_ = 0;  // Re start flashing
            }
        }

        // Check if all data received
        if (all_received && state_ == EspFlashState::WRITING) {
            // Finish flashing (don't reboot yet - allows verification)
            state_ = EspFlashState::FINISHING;
            lcd_status("ESP32 Programmer", "Finishing...");

            if (!flash_finish(false)) {
                setError(last_error_ ? last_error_ : "Finish failed");
                return len - pos;
            }

            state_ = EspFlashState::DONE;
            lcd_status("Flash Complete!", "Ready to verify");
            return len - pos;
        }
    }

    return 0;
}

void EspFlasher::flushCurrentBlock() {
    if (block_buf_pos_ == 0) {
        return;
    }

    // Use stub's 16KB block size when stub is running, otherwise ROM's 1KB
    const uint32_t active_block_size = stub_running_ ? STUB_BLOCK_SIZE : ROM_BLOCK_SIZE;

    // Pad with 0xFF if needed
    size_t block_size = block_buf_pos_;
    if (block_size < active_block_size) {
        memset(&block_buf_[block_size], 0xFF, active_block_size - block_size);
        block_size = active_block_size;
    }

    // Write block
    if (!flash_block(block_buf_, block_size, current_block_seq_)) {
        setError(last_error_ ? last_error_ : "Write failed");
        return;
    }

    current_block_seq_++;
    block_buf_pos_ = 0;

    // Update progress
    int percent = (bytes_received_ * 100) / total_size_;
    lcd_progress("Writing", percent);
}

uint8_t EspFlasher::checksum(const uint8_t* data, size_t len) {
    uint8_t state = ESP_CHECKSUM_MAGIC;
    for (size_t i = 0; i < len; i++) {
        state ^= data[i];
    }
    return state;
}

// Low-level UART read - returns bytes available (non-blocking via callback)
int EspFlasher::uart_read(uint8_t* buf, uint32_t max_len) {
    if (uart_read_cb_) {
        return uart_read_cb_(buf, max_len);
    } else {
        // Fallback to blocking HAL read (1 byte at a time with short timeout)
        if (HAL_UART_Receive(uart_, buf, 1, 1) == HAL_OK) {
            return 1;
        }
        return 0;
    }
}

// Low-level UART write (always blocking HAL, no DMA)
bool EspFlasher::uart_write(const uint8_t* buf, uint32_t len) {
    // Calculate timeout based on data length at 115200 baud
    // ~10 bits per byte (8 data + 1 start + 1 stop), add margin
    // len bytes * 10 bits/byte / 115200 bits/sec * 1000 ms/sec + margin
    uint32_t timeout_ms = (len * 10 * 1000 / 115200) + 500;
    if (timeout_ms < 500) timeout_ms = 500;
    return HAL_UART_Transmit(uart_, (uint8_t*)buf, len, timeout_ms) == HAL_OK;
}

void EspFlasher::slip_send(const uint8_t* data, size_t len) {
    // Send SLIP frame directly without intermediate buffer
    uint8_t byte;

    // Start delimiter
    byte = SLIP_END;
    HAL_UART_Transmit(uart_, &byte, 1, 10);

    // Send data with escaping
    for (size_t i = 0; i < len; i++) {
        if (data[i] == SLIP_END) {
            byte = SLIP_ESC;
            HAL_UART_Transmit(uart_, &byte, 1, 10);
            byte = SLIP_ESC_END;
            HAL_UART_Transmit(uart_, &byte, 1, 10);
        } else if (data[i] == SLIP_ESC) {
            byte = SLIP_ESC;
            HAL_UART_Transmit(uart_, &byte, 1, 10);
            byte = SLIP_ESC_ESC;
            HAL_UART_Transmit(uart_, &byte, 1, 10);
        } else {
            HAL_UART_Transmit(uart_, (uint8_t*)&data[i], 1, 10);
        }
    }

    // End delimiter
    byte = SLIP_END;
    HAL_UART_Transmit(uart_, &byte, 1, 10);
}

int EspFlasher::slip_recv(uint8_t* buf, size_t max_len, uint32_t timeout_ms) {
    uint32_t start = HAL_GetTick();
    size_t pos = 0;
    bool in_packet = false;
    bool in_escape = false;
    bool overflow = false;

    while ((HAL_GetTick() - start) < timeout_ms) {
        uint8_t c;
        int read = uart_read(&c, 1);
        if (read <= 0) {
            continue;
        }

        if (c == SLIP_END) {
            if (in_packet && pos > 0) {
                // End of packet - return error if we overflowed
                if (overflow) {
                    return -2;  // Buffer overflow
                }
                return (int)pos;
            }
            // Start of new packet
            in_packet = true;
            pos = 0;
            overflow = false;
            continue;
        }

        if (!in_packet) {
            continue;
        }

        if (in_escape) {
            in_escape = false;
            if (pos < max_len) {
                if (c == SLIP_ESC_END) {
                    buf[pos++] = SLIP_END;
                } else if (c == SLIP_ESC_ESC) {
                    buf[pos++] = SLIP_ESC;
                }
            } else {
                overflow = true;
            }
        } else if (c == SLIP_ESC) {
            in_escape = true;
        } else {
            if (pos < max_len) {
                buf[pos++] = c;
            } else {
                overflow = true;
            }
        }
    }

    return -1;  // Timeout
}

bool EspFlasher::command(uint8_t opcode, const uint8_t* data, size_t len,
                         uint32_t* resp_val, uint32_t timeout_ms) {
    // Build command packet:
    // Byte 0: direction (0x00 = host to ESP)
    // Byte 1: opcode
    // Bytes 2-3: data length (little-endian)
    // Bytes 4-7: checksum (little-endian, only lower byte used)
    // Bytes 8+: data

    tx_buf_[0] = 0x00;  // Direction: host to ESP
    tx_buf_[1] = opcode;
    tx_buf_[2] = len & 0xFF;
    tx_buf_[3] = (len >> 8) & 0xFF;

    uint8_t chk = checksum(data, len);
    tx_buf_[4] = chk;
    tx_buf_[5] = 0;
    tx_buf_[6] = 0;
    tx_buf_[7] = 0;

    if (len > 0 && data != nullptr) {
        memcpy(&tx_buf_[8], data, len);
    }

    // Send command
    slip_send(tx_buf_, 8 + len);

    // Receive response
    int recv_len = slip_recv(rx_buf_, sizeof(rx_buf_), timeout_ms);
    if (recv_len < 8) {
        last_error_ = "Response timeout";
        return false;
    }

    // Validate response
    // Byte 0: direction (0x01 = ESP to host)
    // Byte 1: opcode (echoed)
    // Bytes 2-3: data length
    // Bytes 4-7: value/status

    if (rx_buf_[0] != 0x01) {
        last_error_ = "Invalid response";
        return false;
    }

    if (rx_buf_[1] != opcode) {
        last_error_ = "Opcode mismatch";
        return false;
    }

    if (resp_val) {
        *resp_val = rx_buf_[4] | (rx_buf_[5] << 8) |
                   (rx_buf_[6] << 16) | (rx_buf_[7] << 24);
    }

    // Check for error in response data
    // Response format: 8-byte header + data + 2-byte status (error, status_code)
    // resp_len includes both data and status bytes
    uint16_t resp_len = rx_buf_[2] | (rx_buf_[3] << 8);
    if (resp_len >= 2 && recv_len >= (int)(8 + resp_len)) {
        // Status bytes are at the END of the response data
        uint8_t error = rx_buf_[8 + resp_len - 2];
        uint8_t status = rx_buf_[8 + resp_len - 1];
        if (error != 0 || status != 0) {
            last_error_ = "Command error";
            return false;
        }
    }

    return true;
}

bool EspFlasher::sync() {
    // SYNC command payload: 0x07 0x07 0x12 0x20 followed by 32 bytes of 0x55
    uint8_t sync_data[36];
    sync_data[0] = 0x07;
    sync_data[1] = 0x07;
    sync_data[2] = 0x12;
    sync_data[3] = 0x20;
    memset(&sync_data[4], 0x55, 32);

    // Try to sync multiple times
    for (int attempt = 0; attempt < 10; attempt++) {
        // Flush RX by reading all available data
        uint8_t dummy;
        uint32_t flush_start = HAL_GetTick();
        while ((HAL_GetTick() - flush_start) < 50) {
            if (uart_read(&dummy, 1) <= 0) {
                break;
            }
        }

        uint32_t resp_val;
        if (command(CMD_SYNC, sync_data, sizeof(sync_data), &resp_val, SYNC_TIMEOUT_MS)) {
            // Success! Read additional responses to clear buffer
            for (int i = 0; i < 7; i++) {
                slip_recv(rx_buf_, sizeof(rx_buf_), 50);
            }
            return true;
        }

        HAL_Delay(50);
    }

    last_error_ = "Sync failed";
    return false;
}

bool EspFlasher::change_baudrate(uint32_t new_baud) {
    uint8_t payload[8];

    // New baud rate
    payload[0] = new_baud & 0xFF;
    payload[1] = (new_baud >> 8) & 0xFF;
    payload[2] = (new_baud >> 16) & 0xFF;
    payload[3] = (new_baud >> 24) & 0xFF;

    uint32_t old_baud = 115200;
    payload[4] = old_baud & 0xFF;
    payload[5] = (old_baud >> 8) & 0xFF;
    payload[6] = (old_baud >> 16) & 0xFF;
    payload[7] = (old_baud >> 24) & 0xFF;

    uint32_t resp;
    if (!command(CMD_SET_BAUDRATE, payload, sizeof(payload), &resp, DEFAULT_TIMEOUT_MS)) {
    	last_error_ = "change buadrate failed";
        return false;
    }

    // Small delay for things to settle
    HAL_Delay(500);

    // Switch your own UART to match
    uart_set_baudrate_cb_(new_baud);

    // Small delay for things to settle
    HAL_Delay(500);

    return true;
}

bool EspFlasher::spi_attach() {
    uint8_t payload[8] = {0};  // Default SPI config
    uint32_t resp;
    if (!command(CMD_SPI_ATTACH, payload, sizeof(payload), &resp, DEFAULT_TIMEOUT_MS)) {
        last_error_ = "spi attach failed";
        return false;
    }

    return true;
}

bool EspFlasher::flash_begin(uint32_t size, uint32_t offset) {
    // Use stub's 16KB block size when stub is running, otherwise ROM's 1KB
    const uint32_t block_size = stub_running_ ? STUB_BLOCK_SIZE : ROM_BLOCK_SIZE;

    // Calculate number of blocks and erase size
    uint32_t num_blocks = (size + block_size - 1) / block_size;

    // Erase size should be sector-aligned
    uint32_t erase_size = ((size + FLASH_SECTOR_SIZE - 1) / FLASH_SECTOR_SIZE) * FLASH_SECTOR_SIZE;

    // Build FLASH_BEGIN payload
    uint8_t payload[20];
    payload[0] = erase_size & 0xFF;
    payload[1] = (erase_size >> 8) & 0xFF;
    payload[2] = (erase_size >> 16) & 0xFF;
    payload[3] = (erase_size >> 24) & 0xFF;

    payload[4] = num_blocks & 0xFF;
    payload[5] = (num_blocks >> 8) & 0xFF;
    payload[6] = (num_blocks >> 16) & 0xFF;
    payload[7] = (num_blocks >> 24) & 0xFF;

    payload[8] = block_size & 0xFF;
    payload[9] = (block_size >> 8) & 0xFF;
    payload[10] = (block_size >> 16) & 0xFF;
    payload[11] = (block_size >> 24) & 0xFF;

    payload[12] = offset & 0xFF;
    payload[13] = (offset >> 8) & 0xFF;
    payload[14] = (offset >> 16) & 0xFF;
    payload[15] = (offset >> 24) & 0xFF;

    payload[16] = 0x00;
    payload[17] = 0x00;
    payload[18] = 0x00;
    payload[19] = 0x00;

    // Calculate timeout based on size (30s per MB for erase)
    uint32_t timeout = DEFAULT_TIMEOUT_MS + (size / (1024 * 1024) + 1) * ERASE_TIMEOUT_PER_MB_MS;

    uint32_t resp_val;
    if (!command(CMD_FLASH_BEGIN, payload, sizeof(payload), &resp_val, timeout)) {
        last_error_ = "Erase failed";
        return false;
    }

    return true;
}

bool EspFlasher::flash_block(const uint8_t* data, size_t len, uint32_t seq) {
    // Build FLASH_DATA payload header
    uint8_t header[16];
    header[0] = len & 0xFF;
    header[1] = (len >> 8) & 0xFF;
    header[2] = (len >> 16) & 0xFF;
    header[3] = (len >> 24) & 0xFF;

    header[4] = seq & 0xFF;
    header[5] = (seq >> 8) & 0xFF;
    header[6] = (seq >> 16) & 0xFF;
    header[7] = (seq >> 24) & 0xFF;

    memset(&header[8], 0, 8);  // Reserved fields

    // Build full packet in tx_buf_
    tx_buf_[0] = 0x00;  // Direction
    tx_buf_[1] = CMD_FLASH_DATA;
    uint16_t total_len = 16 + len;
    tx_buf_[2] = total_len & 0xFF;
    tx_buf_[3] = (total_len >> 8) & 0xFF;

    // Checksum over all payload data
    uint8_t chk = ESP_CHECKSUM_MAGIC;
    for (size_t i = 0; i < len; i++) chk ^= data[i];

    tx_buf_[4] = chk;
    tx_buf_[5] = 0;
    tx_buf_[6] = 0;
    tx_buf_[7] = 0;

    memcpy(&tx_buf_[8], header, 16);
    memcpy(&tx_buf_[24], data, len);

    slip_send(tx_buf_, 8 + 16 + len);

    // Receive response
    int recv_len = slip_recv(rx_buf_, sizeof(rx_buf_), DEFAULT_TIMEOUT_MS);
    if (recv_len < 8) {
        last_error_ = "Write timeout";
        return false;
    }

    if (rx_buf_[0] != 0x01 || rx_buf_[1] != CMD_FLASH_DATA) {
        last_error_ = "Write failed";
        return false;
    }

    // Check for error
    uint16_t resp_len = rx_buf_[2] | (rx_buf_[3] << 8);
    if (resp_len >= 2 && recv_len >= 10) {
        if (rx_buf_[8] != 0 || rx_buf_[9] != 0) {
            last_error_ = "Write error";
            return false;
        }
    }

    return true;
}

bool EspFlasher::flash_finish(bool reboot) {
    // FLASH_END payload
    uint8_t payload[4];
    uint32_t flag = reboot ? 0 : 1;  // 0 = reboot, 1 = stay
    payload[0] = flag & 0xFF;
    payload[1] = (flag >> 8) & 0xFF;
    payload[2] = (flag >> 16) & 0xFF;
    payload[3] = (flag >> 24) & 0xFF;

    uint32_t resp_val;
    bool ok = command(CMD_FLASH_END, payload, sizeof(payload), &resp_val, DEFAULT_TIMEOUT_MS);

    // Timeout is expected when rebooting
    if (!ok && reboot) {
        return true;  // Probably fine
    }

    if (!ok) {
        last_error_ = "Finish failed";
        return false;
    }

    return true;
}

void EspFlasher::lcd_status(const char* line1, const char* line2) {
	return;
    if (!lcd_) return;

    Lcd_cursor(lcd_, 2, 0);
    Lcd_string(lcd_, "                    ");
    Lcd_cursor(lcd_, 3, 0);
    Lcd_string(lcd_, "                    ");
    Lcd_cursor(lcd_, 2, 0);
    Lcd_string(lcd_, line1);

    if (line2) {
        Lcd_cursor(lcd_, 3, 0);
        Lcd_string(lcd_, line2);
    }
}

void EspFlasher::lcd_progress(const char* operation, int percent) {
	return;
    if (!lcd_) return;

    char buf[21];
    snprintf(buf, sizeof(buf), "%-12s %3d%%", operation, percent);

    Lcd_cursor(lcd_, 3, 0);
    Lcd_string(lcd_, buf);
}

// RAM upload methods for stub loader

bool EspFlasher::mem_begin(uint32_t size, uint32_t num_blocks, uint32_t block_size, uint32_t offset) {
    uint8_t payload[16];

    // Size
    payload[0] = size & 0xFF;
    payload[1] = (size >> 8) & 0xFF;
    payload[2] = (size >> 16) & 0xFF;
    payload[3] = (size >> 24) & 0xFF;

    // Number of blocks
    payload[4] = num_blocks & 0xFF;
    payload[5] = (num_blocks >> 8) & 0xFF;
    payload[6] = (num_blocks >> 16) & 0xFF;
    payload[7] = (num_blocks >> 24) & 0xFF;

    // Block size
    payload[8] = block_size & 0xFF;
    payload[9] = (block_size >> 8) & 0xFF;
    payload[10] = (block_size >> 16) & 0xFF;
    payload[11] = (block_size >> 24) & 0xFF;

    // Offset (load address)
    payload[12] = offset & 0xFF;
    payload[13] = (offset >> 8) & 0xFF;
    payload[14] = (offset >> 16) & 0xFF;
    payload[15] = (offset >> 24) & 0xFF;

    uint32_t resp_val;
    if (!command(CMD_MEM_BEGIN, payload, sizeof(payload), &resp_val, DEFAULT_TIMEOUT_MS)) {
        last_error_ = "MEM_BEGIN failed";
        return false;
    }

    return true;
}

bool EspFlasher::mem_data(const uint8_t* data, size_t len, uint32_t seq) {
    // Build MEM_DATA payload header (same format as FLASH_DATA)
    uint8_t header[16];
    header[0] = len & 0xFF;
    header[1] = (len >> 8) & 0xFF;
    header[2] = (len >> 16) & 0xFF;
    header[3] = (len >> 24) & 0xFF;

    header[4] = seq & 0xFF;
    header[5] = (seq >> 8) & 0xFF;
    header[6] = (seq >> 16) & 0xFF;
    header[7] = (seq >> 24) & 0xFF;

    memset(&header[8], 0, 8);  // Reserved fields

    // Build full packet in tx_buf_
    tx_buf_[0] = 0x00;  // Direction
    tx_buf_[1] = CMD_MEM_DATA;
    uint16_t total_len = 16 + len;
    tx_buf_[2] = total_len & 0xFF;
    tx_buf_[3] = (total_len >> 8) & 0xFF;

    // Checksum over data only (not header)
    uint8_t chk = ESP_CHECKSUM_MAGIC;
    for (size_t i = 0; i < len; i++) chk ^= data[i];

    tx_buf_[4] = chk;
    tx_buf_[5] = 0;
    tx_buf_[6] = 0;
    tx_buf_[7] = 0;

    memcpy(&tx_buf_[8], header, 16);
    memcpy(&tx_buf_[24], data, len);

    slip_send(tx_buf_, 8 + 16 + len);

    // Receive response - use longer timeout for RAM operations
    int recv_len = slip_recv(rx_buf_, sizeof(rx_buf_), DEFAULT_TIMEOUT_MS + 2000);
    if (recv_len < 8) {
        last_error_ = "MEM_DATA timeout";
        return false;
    }

    if (rx_buf_[0] != 0x01 || rx_buf_[1] != CMD_MEM_DATA) {
        last_error_ = "MEM_DATA bad resp";
        return false;
    }

    // Check for error
    uint16_t resp_len = rx_buf_[2] | (rx_buf_[3] << 8);
    if (resp_len >= 2 && recv_len >= 10) {
        if (rx_buf_[8] != 0 || rx_buf_[9] != 0) {
            last_error_ = "MEM_DATA error";
            return false;
        }
    }

    return true;
}

bool EspFlasher::mem_end(uint32_t entry_point, bool execute) {
    uint8_t payload[8];

    // Execute flag (0 = execute, 1 = don't execute)
    uint32_t exec_flag = execute ? 0 : 1;
    payload[0] = exec_flag & 0xFF;
    payload[1] = (exec_flag >> 8) & 0xFF;
    payload[2] = (exec_flag >> 16) & 0xFF;
    payload[3] = (exec_flag >> 24) & 0xFF;

    // Entry point
    payload[4] = entry_point & 0xFF;
    payload[5] = (entry_point >> 8) & 0xFF;
    payload[6] = (entry_point >> 16) & 0xFF;
    payload[7] = (entry_point >> 24) & 0xFF;

    uint32_t resp_val;
    if (!command(CMD_MEM_END, payload, sizeof(payload), &resp_val, DEFAULT_TIMEOUT_MS)) {
        // Timeout is expected when executing - stub may not respond
        if (execute) {
            return true;  // Probably fine
        }
        last_error_ = "MEM_END failed";
        return false;
    }

    return true;
}

bool EspFlasher::upload_stub() {
    // Upload text segment
    uint32_t text_blocks = (STUB_TEXT_SIZE + MEM_BLOCK_SIZE - 1) / MEM_BLOCK_SIZE;

    if (!mem_begin(STUB_TEXT_SIZE, text_blocks, MEM_BLOCK_SIZE, STUB_TEXT_START)) {
        last_error_ = "MEM_BEGIN text failed";
        return false;
    }

    for (uint32_t seq = 0; seq < text_blocks; seq++) {
        uint32_t offset = seq * MEM_BLOCK_SIZE;
        uint32_t remaining = STUB_TEXT_SIZE - offset;
        uint32_t chunk_size = (remaining > MEM_BLOCK_SIZE) ? MEM_BLOCK_SIZE : remaining;

        if (!mem_data(&STUB_TEXT[offset], chunk_size, seq)) {
            return false;
        }
    }

    // Upload data segment
    uint32_t data_blocks = (STUB_DATA_SIZE + MEM_BLOCK_SIZE - 1) / MEM_BLOCK_SIZE;

    if (!mem_begin(STUB_DATA_SIZE, data_blocks, MEM_BLOCK_SIZE, STUB_DATA_START)) {
        last_error_ = "MEM_BEGIN data failed";
        return false;
    }

    for (uint32_t seq = 0; seq < data_blocks; seq++) {
        uint32_t offset = seq * MEM_BLOCK_SIZE;
        uint32_t remaining = STUB_DATA_SIZE - offset;
        uint32_t chunk_size = (remaining > MEM_BLOCK_SIZE) ? MEM_BLOCK_SIZE : remaining;

        if (!mem_data(&STUB_DATA[offset], chunk_size, seq)) {
            return false;
        }
    }

    // Execute stub at entry point
    if (!mem_end(STUB_ENTRY, true)) {
        last_error_ = "MEM_END failed";
        return false;
    }

    return true;
}

bool EspFlasher::wait_for_ohai(uint32_t timeout_ms) {
    // Stub sends "OHAI" as a SLIP packet when ready: 0xC0 'O' 'H' 'A' 'I' 0xC0
    uint32_t start = HAL_GetTick();

    while ((HAL_GetTick() - start) < timeout_ms) {
        int recv_len = slip_recv(rx_buf_, sizeof(rx_buf_), 100);
        if (recv_len == 4) {
            if (rx_buf_[0] == 'O' && rx_buf_[1] == 'H' &&
                rx_buf_[2] == 'A' && rx_buf_[3] == 'I') {
                return true;
            }
        }
    }

    last_error_ = "No OHAI from stub";
    return false;
}

bool EspFlasher::read_flash(uint32_t offset, uint32_t size, uint8_t* data_out) {
    // READ_FLASH command payload: offset, length, sector_size, max_inflight
    // (esptool format: struct.pack("<IIII", offset, length, FLASH_SECTOR_SIZE, 64))
    uint8_t payload[16];

    // Offset
    payload[0] = offset & 0xFF;
    payload[1] = (offset >> 8) & 0xFF;
    payload[2] = (offset >> 16) & 0xFF;
    payload[3] = (offset >> 24) & 0xFF;

    // Length to read
    payload[4] = size & 0xFF;
    payload[5] = (size >> 8) & 0xFF;
    payload[6] = (size >> 16) & 0xFF;
    payload[7] = (size >> 24) & 0xFF;

    // Sector size - use 4KB (standard flash sector size)
    // For larger reads, stub sends multiple packets
    uint32_t sector_size = FLASH_SECTOR_SIZE;
    payload[8] = sector_size & 0xFF;
    payload[9] = (sector_size >> 8) & 0xFF;
    payload[10] = (sector_size >> 16) & 0xFF;
    payload[11] = (sector_size >> 24) & 0xFF;

    // Max in-flight packets (1 = wait for ack after each packet)
    uint32_t max_inflight = 1;
    payload[12] = max_inflight & 0xFF;
    payload[13] = (max_inflight >> 8) & 0xFF;
    payload[14] = (max_inflight >> 16) & 0xFF;
    payload[15] = (max_inflight >> 24) & 0xFF;

    // Send READ_FLASH command
    tx_buf_[0] = 0x00;  // Direction
    tx_buf_[1] = CMD_READ_FLASH;
    tx_buf_[2] = 16;    // Payload length
    tx_buf_[3] = 0;

    // Checksum over payload
    uint8_t chk = ESP_CHECKSUM_MAGIC;
    for (int i = 0; i < 16; i++) chk ^= payload[i];

    tx_buf_[4] = chk;
    tx_buf_[5] = 0;
    tx_buf_[6] = 0;
    tx_buf_[7] = 0;

    memcpy(&tx_buf_[8], payload, 16);
    slip_send(tx_buf_, 8 + 16);

    // First receive command response (8-byte header + 2-byte status)
    int recv_len = slip_recv(rx_buf_, sizeof(rx_buf_), DEFAULT_TIMEOUT_MS);
    if (recv_len < 10) {
        last_error_ = "Read cmd timeout";
        return false;
    }

    // Check response: direction=1, cmd=READ_FLASH, status bytes at [8],[9]
    if (rx_buf_[0] != 0x01 || rx_buf_[1] != CMD_READ_FLASH) {
        last_error_ = "Read cmd bad resp";
        return false;
    }
    // Check for error: [8] = failed flag, [9] = error code
    if (rx_buf_[8] != 0 || rx_buf_[9] != 0) {
        last_error_ = "Read cmd error";
        return false;
    }

    // Receive data in sector_size chunks, sending ack after each
    uint32_t num_packets = (size + sector_size - 1) / sector_size;
    uint32_t bytes_received = 0;

    for (uint32_t i = 0; i < num_packets; i++) {
        uint32_t packet_size = (i == num_packets - 1) ? (size - bytes_received) : sector_size;

        recv_len = slip_recv(data_out + bytes_received, packet_size, DEFAULT_TIMEOUT_MS);
        if (recv_len == -2) {
            last_error_ = "Read flash overflow";
            return false;
        }
        if (recv_len < (int)packet_size) {
            last_error_ = "Read flash timeout";
            return false;
        }

        bytes_received += packet_size;

        // Send acknowledgment (4-byte cumulative length)
        uint8_t ack[4];
        ack[0] = bytes_received & 0xFF;
        ack[1] = (bytes_received >> 8) & 0xFF;
        ack[2] = (bytes_received >> 16) & 0xFF;
        ack[3] = (bytes_received >> 24) & 0xFF;
        slip_send(ack, 4);
    }

    // Receive final MD5 digest (stub sends this after acknowledgment)
    recv_len = slip_recv(rx_buf_, sizeof(rx_buf_), DEFAULT_TIMEOUT_MS);
    if (recv_len < 16) {
        last_error_ = "Read flash MD5 missing";
        return false;
    }

    return true;
}

bool EspFlasher::readFlashSha256(uint32_t offset, uint32_t size, uint8_t sha256_out[32]) {
    // Stub must be initialized via initStub() before calling this
    if (!stub_running_) {
        last_error_ = "Stub not initialized";
        return false;
    }

    lcd_status("Verifying...", "Computing SHA256");

    // Build CMD_FLASH_SHA256 payload: offset (4 bytes) + size (4 bytes) + padding (8 bytes)
    // Same format as MD5 command for compatibility
    uint8_t payload[16];
    payload[0] = offset & 0xFF;
    payload[1] = (offset >> 8) & 0xFF;
    payload[2] = (offset >> 16) & 0xFF;
    payload[3] = (offset >> 24) & 0xFF;
    payload[4] = size & 0xFF;
    payload[5] = (size >> 8) & 0xFF;
    payload[6] = (size >> 16) & 0xFF;
    payload[7] = (size >> 24) & 0xFF;
    memset(&payload[8], 0, 8);  // Padding (same as MD5 command)

    // Calculate timeout: ~1ms per 4KB sector + margin
    // For 4MB: ~1024 sectors * 1ms = ~1 second, add generous margin
    uint32_t timeout = 50000 + (size / FLASH_SECTOR_SIZE) * 2;

    uint32_t resp_val;
    if (!command(CMD_FLASH_SHA256, payload, sizeof(payload), &resp_val, timeout)) {
        return false;
    }

    // Response contains 32-byte SHA256 digest starting at rx_buf_[8]
    // (after 8-byte response header)
    memcpy(sha256_out, &rx_buf_[8], 32);

    return true;
}

bool EspFlasher::readFlashBytes(uint32_t offset, uint32_t size, uint8_t* data_out) {
    if (!stub_running_) {
        last_error_ = "Stub not initialized";
        return false;
    }

    // Limit size to prevent buffer issues
    if (size > FLASH_SECTOR_SIZE) {
        size = FLASH_SECTOR_SIZE;
    }

    return read_flash(offset, size, data_out);
}
