// Allman Style Formatting Applied

// Global Constants (Device Modes)
const RUN_MODE = 0;
const PROG_MODE = 1;

// --- PicUsbInterface Class Definition ---
class PicUsbInterface
{
    constructor()
    {
        // Constants
        this.PRG_START_ADD = 0x1400; // must be 1024 byte boundary!
        this.PACKET_HEADER_SIZE = 5;
        this.BUFFER_SIZE = 32;
        this.PACKET_SIZE = 37;
        this.IMAGE_SIZE = 65536;
        this.VID = 0x1240; // Vendor ID as number for WebHID
        this.PID = 0xfa7a; // Product ID as number for WebHID
        this.USING_ENCRYPTION = false; // Example if needed later

        // Interface commands
        this.CMD_PROGRAM_MEM_BLOCK = 1;
        this.CMD_READ_EEPROM_PAGE = 2;
        this.CMD_EEPROM_CLEAR_PROTECTION = 3;
        this.CMD_ERASE_EEPROM_BLOCK = 4; // 64K
        this.CMD_WRITE_EEPROM_PAGE = 5;
        this.CMD_SET_MODE = 6;
        this.CMD_ACK = 13;

        // EEPROM Layout Constants
        this.EEPROM_CONFIG_BLOCK_SIZE = 32;
        this.EEPROM_VOICE_MAP_ENTRY_SIZE = 6;
        this.EEPROM_BLOCK_SIZE = 0x10000; // 64K
        this.EEPROM_VOICE_BANK_SIZE = 0x100000; // 1MB
        this.EEPROM_VOICE_MAP_OFFSET = 0x400; // Start of map within a bank
        this.VOICE_BANK_1_OFFSET = 0x100000;
        this.VOICE_BANK_2_OFFSET = 0x200000;
        this.VOICE_BANK_3_OFFSET = 0x300000;

        // Robustness additions
        this.READ_TIMEOUT = 2000; // Timeout for reads in milliseconds (e.g., 2 seconds)
        this.isReading = false; // Flag to prevent concurrent reads

        // HID related state
        this.device = null;
        this.deviceDetected = false;
        this.packet = new Uint8Array(this.PACKET_SIZE);
    }

    /**
     * Helper to split address into bytes
     * @param {number} add - The address integer
     * @returns {{highAdd: number, midAdd: number, lowAdd: number}} Address components
     */
    getAddressBytes(add)
    {
        const highAdd = (add >> 16) & 0xff;
        const midAdd = (add >> 8) & 0xff;
        const lowAdd = add & 0xff;
        return { highAdd, midAdd, lowAdd };
    }

    /**
     * Request user permission to access HID device
     * @returns {Promise<boolean>} True if device selected and assigned, false otherwise
     */
    async requestDevice()
    {
        try
        {
            const filters = [{ vendorId: this.VID, productId: this.PID }];
            const devices = await navigator.hid.requestDevice({ filters });
            if (devices.length > 0)
            {
                this.device = devices[0];
                this.deviceDetected = true;
                console.log("HID Device selected by user.");
                return true;
            }
            console.log("No HID device selected by user.");
            return false;
        }
        catch (error)
        {
            console.error("Error requesting HID device:", error);
            this.deviceDetected = false;
            return false;
        }
    }

    /**
     * Check for already paired devices (Note: May not work reliably depending on browser permissions)
     * @returns {Promise<boolean>} True if a matching paired device is found, false otherwise
     */
    async detectDevice()
    {
        try
        {
            const devices = await navigator.hid.getDevices();
            for (let device of devices)
            {
                if (device.vendorId === this.VID && device.productId === this.PID)
                {
                    this.device = device;
                    this.deviceDetected = true;
                    console.log("Pre-authorized HID device detected.");
                    return true;
                }
            }
            console.log("No matching pre-authorized HID device found.");
            this.deviceDetected = false;
            return false;
        }
        catch (error)
        {
            console.error("Error detecting HID device:", error);
            this.deviceDetected = false;
            return false;
        }
    }

    /**
     * Open connection to the selected/detected device
     * @returns {Promise<boolean>} True if device opened successfully, false otherwise
     */
    async openDevice()
    {
        if (!this.deviceDetected || !this.device)
        {
            console.error("Cannot open: No device detected or selected.");
            return false;
        }

        try
        {
            if (!this.device.opened)
            {
                await this.device.open();
                console.log("HID Device opened successfully.");
            }
            return true;
        }
        catch (error)
        {
            console.error("Error opening HID device:", error);
            return false;
        }
    }

    /**
     * Close connection to the device
     * @returns {Promise<boolean>} True if device closed successfully, false otherwise
     */
    async closeDevice()
    {
        // Reset reading flag if device is closed mid-read
        this.isReading = false;

        if (this.device && this.device.opened)
        {
            try
            {
                await this.device.close();
                console.log("HID Device closed.");
                this.deviceDetected = false; // Reset detection status on close
                this.device = null;
                return true;
            }
            catch (error)
            {
                console.error("Error closing HID device:", error);
            }
        }
        // Ensure flags are reset even if device wasn't open
        this.deviceDetected = false;
        this.device = null;
        return false;
    }

    /**
     * Write a data packet (output report) to the device.
     * More robust logging.
     * @returns {Promise<boolean>} True if write successful, false otherwise.
     */
    async writeDataPacket()
    {
        if (!this.deviceDetected || !this.device)
        {
            console.error("writeDataPacket Error: Device not detected.");
            return false;
        }
        if (!this.device.opened)
        {
            console.error("writeDataPacket Error: Device not open.");
            return false;
        }

        try
        {
            // console.debug("Writing packet:", this.packet); // Optional: Log outgoing packet for debugging
            // Report ID 0 is common, adjust if your device uses others
            await this.device.sendReport(0, this.packet);
            // console.debug("Packet sent successfully via sendReport.");
            return true;
        }
        catch (error)
        {
            // Log the specific error for better diagnosis
            console.error("Error writing data packet (sendReport failed):", error);
            return false;
        }
    }

    /**
     * Read a data packet (input report) from the device.
     * Includes timeout and concurrency guard.
     * @returns {Promise<Uint8Array | null>} The received data as Uint8Array, or null on failure/timeout.
     */
    async readDataPacket()
    {
        if (!this.deviceDetected || !this.device)
        {
            console.error("readDataPacket Error: Device not detected.");
            return null;
        }
        if (!this.device.opened)
        {
            console.error("readDataPacket Error: Device not open.");
            return null;
        }

        // Concurrency Guard
        if (this.isReading)
        {
            console.warn("readDataPacket Warning: Read attempt ignored while another read is in progress.");
            return null; // Indicate failure due to concurrency
        }
        this.isReading = true; // Set lock

        // Use a Promise to handle the async event and timeout
        return new Promise((resolve, reject) =>
        {
            let timeoutId = null;
            let reportListener = null; // To hold the listener function for removal

            // Define the listener function
            reportListener = (event) =>
            {
                clearTimeout(timeoutId); // Cancel timeout
                // No need to remove listener explicitly due to { once: true }
                this.isReading = false; // Release lock

                const receivedData = new Uint8Array(event.data.buffer);
                // console.debug("Input report received:", receivedData); // Optional: Log received data

                // Update the class's internal packet buffer *if* callers rely on it
                // Being up-to-date after a read (like writeVoiceBankCount did).
                this.packet.set(receivedData); // Copy received data into internal buffer

                resolve(receivedData); // Resolve the Promise with the data
            };

            // Define the timeout handler
            const onTimeout = () =>
            {
                // Important: Attempt to remove the listener if timeout occurs before report received
                // Note: With { once: true }, this might be redundant but safe
                if (reportListener && this.device && this.device.opened)
                {
                    try { this.device.removeEventListener("inputreport", reportListener); } catch(e) {/* Ignore potential errors if already removed */}
                }
                this.isReading = false; // Release lock
                console.error(`readDataPacket Error: Timeout after ${this.READ_TIMEOUT}ms waiting for input report.`);
                reject(new Error("Read timeout")); // Reject the Promise due to timeout
            };

            try
            {
                // Add the event listener - use { once: true } for automatic removal on event
                this.device.addEventListener("inputreport", reportListener, { once: true });

                // Start the timeout timer
                timeoutId = setTimeout(onTimeout, this.READ_TIMEOUT);
                // console.debug("readDataPacket: Listener added, waiting for input report or timeout...");
            }
            catch (error)
            {
                 // Catch errors during listener setup
                 clearTimeout(timeoutId); // Clean up timer if setup fails
                 this.isReading = false; // Release lock
                 console.error("readDataPacket Error: Failed to set up input report listener:", error);
                 reject(error); // Reject the promise if setup fails
            }

        }).catch(error =>
        {
            // Catch rejections from the Promise (timeout, listener setup error, etc.)
            // Ensure the lock is always released on any error path
            this.isReading = false;
            console.error("readDataPacket failed:", error.message); // Log the reason for failure
            return null; // Return null uniformly on failure/timeout
        });
    }

    /**
     * Write a command packet and wait for an ACK.
     * Uses the updated readDataPacket which returns data or null.
     * @param {number} cmd - The command byte
     * @param {number} highAdd - High address byte
     * @param {number} midAdd - Middle address byte
     * @param {number} lowAdd - Low address byte
     * @param {Uint8Array | null} data - Payload data or null
     * @returns {Promise<boolean>} True if command sent and ACK received, false otherwise
     */
    async writeCommandPacket(cmd, highAdd, midAdd, lowAdd, data)
    {
        // --- Prepare packet (same as before) ---
        this.packet.fill(0);
        this.packet[0] = cmd;
        this.packet[1] = highAdd;
        this.packet[2] = midAdd;
        this.packet[3] = lowAdd;

        if (data === null || data === undefined)
        {
            this.packet[4] = 0;
        }
        else
        {
            const payloadLength = Math.min(data.length, this.PACKET_SIZE - this.PACKET_HEADER_SIZE);
            this.packet[4] = payloadLength;
            // Use subarray for potentially better performance/clarity if data is large
            this.packet.set(data.subarray(0, payloadLength), this.PACKET_HEADER_SIZE);
            if (payloadLength < data.length)
            {
                 console.warn(`Command ${cmd}: Payload truncated from ${data.length} to ${payloadLength} bytes.`);
            }
        }
        // --- End Prepare packet ---


        try
        {
            // 1. Write the command packet
            if (!await this.writeDataPacket())
            {
                 console.error(`Command ${cmd}: Failed during writeDataPacket.`);
                 return false;
            }

            // 2. Read the response packet
            const receivedData = await this.readDataPacket(); // Returns Uint8Array or null

            // 3. Check the response
            if (receivedData === null)
            {
                // Error (e.g., timeout) already logged by readDataPacket
                console.error(`Command ${cmd}: Failed to receive response (readDataPacket returned null).`);
                return false;
            }

            // Check if the first byte of the *received* data is ACK
            // Note: this.packet was also updated inside readDataPacket for legacy compatibility
            if (receivedData[0] === this.CMD_ACK)
            {
                // console.debug(`Command ${cmd}: ACK received.`);
                return true;
            }
            else
            {
                console.error(`Command ${cmd}: NACK or unexpected response received. Byte 0: ${receivedData[0]}`);
                // You might want to log the whole received packet here for debugging:
                // console.error("Full Response Packet:", receivedData);
                return false;
            }
        }
        catch(error)
        {
            // Catch any unexpected errors during the async operations
            console.error(`Command ${cmd}: Unexpected error during write/read cycle:`, error);
            return false;
        }
    }

    /**
     * Load records from an Intel HEX file fetched from the server
     * @param {string} firmwareFile - URL path to the HEX file
     * @returns {Promise<string[]>} Array of hex record strings (without ':') or empty array on error
     */
    async loadRecordSet(firmwareFile)
    {
        try
        {
            const response = await fetch(firmwareFile);
            if (!response.ok)
            {
                throw new Error(`Failed to fetch file: ${response.statusText} (URL: ${firmwareFile})`);
            }
            const text = await response.text();

            // Split on newline, filter empty lines, trim whitespace, and check for ':' prefix
            const lines = text.split('\n');
            const recordSet = [];

            for (const line of lines)
            {
                const trimmedLine = line.trim();
                if (trimmedLine.length > 0 && trimmedLine.startsWith(':'))
                {
                    recordSet.push(trimmedLine.substring(1));
                }
            }
            return recordSet;
        }
        catch (error)
        {
            console.error("Error loading hex record set:", error);
            return [];
        }
    }

    /**
     * Parse a single Intel HEX record string
     * @param {string} recordStr - Hex record string (without ':')
     * @returns {object | null} Parsed record object or null if invalid
     */
    parseRecord(recordStr)
    {
        // Minimal validation, assumes correct format from loadRecordSet
        if (recordStr.length < 11) return null; // Min length: CCLLAA00DDCS

        try
        {
            const record = {};
            let tempStr = recordStr;

            record.dataSize = parseInt(tempStr.substring(0, 2), 16);
            tempStr = tempStr.substring(2);

            record.midAdd = parseInt(tempStr.substring(0, 2), 16); // Actually high byte of 16-bit address
            tempStr = tempStr.substring(2);

            record.lowAdd = parseInt(tempStr.substring(0, 2), 16); // Low byte of 16-bit address
            tempStr = tempStr.substring(2);

            record.recType = parseInt(tempStr.substring(0, 2), 16);
            tempStr = tempStr.substring(2);

            // Basic check: Does length match expected?
            if (tempStr.length !== (record.dataSize * 2) + 2) // data bytes + checksum byte
            {
                 console.warn("Hex record parse warning: Length mismatch", recordStr);
            }

            record.data = new Uint8Array(record.dataSize);
            for (let i = 0; i < record.dataSize; i++)
            {
                record.data[i] = parseInt(tempStr.substring(0, 2), 16);
                tempStr = tempStr.substring(2);
            }

            record.checkSum = parseInt(tempStr.substring(0, 2), 16);
            // TODO: Add checksum validation if needed

            record.highAdd = 0x00; // Default, updated by type 04 records

            return record;
        }
        catch (e)
        {
             console.error("Error parsing hex record:", recordStr, e);
             return null;
        }
    }

    /**
     * Parse an entire Intel HEX file content
     * @param {string} firmwareFile - URL path to the HEX file
     * @returns {Promise<object[]>} Array of parsed record objects or empty array on error
     */
    async parseFile(firmwareFile)
    {
        let recordSet;
        try
        {
            recordSet = await this.loadRecordSet(firmwareFile);
            if (recordSet.length === 0)
            {
                 console.warn("No valid records loaded from hex file:", firmwareFile);
                 return [];
            }
        }
        catch (error)
        {
            console.error("Error loading record set for parsing:", error);
            return [];
        }

        const hexSet = [];
        for (let i = 0; i < recordSet.length; i++)
        {
            const parsed = this.parseRecord(recordSet[i]);
            if (parsed) // Only add valid records
            {
                hexSet.push(parsed);
            }
        }
        return hexSet;
    }

    /**
     * Write firmware image from a HEX file to the device's program memory
     * @param {string} firmwareFile - URL path to the HEX file
     * @returns {Promise<boolean>} True on success, false on failure
     */
    async writeImage(firmwareFile)
    {
        const hexImage = new Uint8Array(this.IMAGE_SIZE);
        let hexSet = [];

        try
        {
            hexSet = await this.parseFile(firmwareFile);
            if (hexSet.length === 0)
            {
                 throw new Error("Hex file parsing yielded no data.");
            }
        }
        catch (error)
        {
            console.error("Error parsing hex file for writing image:", error);
            return false;
        }

        // Fill image buffer with 0xFF (NOP/erased state)
        hexImage.fill(0xFF);

        let extendedLinearAddress = 0; // For handling type 04 records
        let maxAddress = 0; // Track highest address written

        // Populate the image buffer from hex records
        for (const hexData of hexSet)
        {
            if (hexData.recType === 0x04 && hexData.dataSize === 2)
            {
                extendedLinearAddress = (hexData.data[0] << 8) | hexData.data[1];
            }
            else if (hexData.recType === 0x00)
            {
                let currentAddress = (extendedLinearAddress << 16) + (hexData.midAdd << 8) + hexData.lowAdd;

                for (let i = 0; i < hexData.dataSize; i++)
                {
                    if (currentAddress < this.IMAGE_SIZE) // Bounds check
                    {
                        hexImage[currentAddress] = hexData.data[i];
                        maxAddress = Math.max(maxAddress, currentAddress);
                        currentAddress++;
                    }
                    else
                    {
                         console.warn(`Hex record address ${currentAddress.toString(16)} exceeds image size ${this.IMAGE_SIZE.toString(16)}`);
                         break;
                    }
                }
            }
            else if (hexData.recType === 0x01)
            {
                 break; // End of File record
            }
        }

        // Determine actual data range to write
        const startWriteAddress = this.PRG_START_ADD;
        const endWriteAddress = maxAddress;
        const totalBytesToWrite = endWriteAddress >= startWriteAddress ? (endWriteAddress - startWriteAddress + 1) : 0;

        if (totalBytesToWrite <= 0)
        {
            console.warn("No data found within the programmable range to write.");
            return true; // Successful if nothing needed writing
        }

        const bufferCnt = Math.floor(totalBytesToWrite / this.BUFFER_SIZE);
        const remCount = totalBytesToWrite % this.BUFFER_SIZE;
        const buffer = new Uint8Array(this.BUFFER_SIZE);
        let imgIndex = startWriteAddress;
        let currentDeviceAddress = startWriteAddress;

        // Process all complete buffers
        for (let bc = 0; bc < bufferCnt; bc++)
        {
            buffer.set(hexImage.subarray(imgIndex, imgIndex + this.BUFFER_SIZE));
            imgIndex += this.BUFFER_SIZE;

            const { highAdd, midAdd, lowAdd } = this.getAddressBytes(currentDeviceAddress);
            if (!await this.writeCommandPacket(this.CMD_PROGRAM_MEM_BLOCK, highAdd, midAdd, lowAdd, buffer))
            {
                console.error(`Failed to write program block at address ${currentDeviceAddress.toString(16)}`);
                return false; // Abort on failure
            }
            currentDeviceAddress += this.BUFFER_SIZE;
        }

        // Write last remainder block if there is one
        if (remCount > 0)
        {
            buffer.fill(0xFF); // Fill remainder buffer first
            const remainderData = hexImage.subarray(imgIndex, imgIndex + remCount);
            buffer.set(remainderData); // Copy into the start of the buffer

            const { highAdd, midAdd, lowAdd } = this.getAddressBytes(currentDeviceAddress);
            if (!await this.writeCommandPacket(this.CMD_PROGRAM_MEM_BLOCK, highAdd, midAdd, lowAdd, buffer)) // Send the partially filled buffer
            {
                 console.error(`Failed to write final program block at address ${currentDeviceAddress.toString(16)}`);
                 return false; // Abort on failure
            }
        }

        console.log("Firmware image write completed.");
        return true;
    }

    /**
     * Write mode byte to device
     * @param {number} mode - The mode value (e.g., RUN_MODE, PROG_MODE)
     * @returns {Promise<boolean>} True on success, false on failure
     */
    async writeMode(mode)
    {
        const block = new Uint8Array([mode]); // Create array with the mode byte
        if (!await this.writeCommandPacket(this.CMD_SET_MODE, 0, 0, 0, block))
        {
             console.error(`Failed to set mode to ${mode}`);
             return false;
        }
        console.log(`Mode set to ${mode}`);
        return true;
    }

    /**
     * Erase a voice bank (assumed 1MB) in external EEPROM
     * @param {number} bankOffset - Starting address of the bank (e.g., 0x100000)
     * @returns {Promise<boolean>} True on success, false on failure
     */
    async eraseVoiceBank(bankOffset)
    {
        console.log(`Starting erase for bank at 0x${bankOffset.toString(16)}`);
        // 1. Clear write protection (if required by device for erase)
        if (!await this.writeCommandPacket(this.CMD_EEPROM_CLEAR_PROTECTION, 0, 0, 0, null))
        {
            console.error("Failed to clear EEPROM protection before erase.");
            return false;
        }
        console.log("EEPROM protection cleared (attempted).");

        let addPtr = bankOffset;
        const blocksToErase = this.EEPROM_VOICE_BANK_SIZE / this.EEPROM_BLOCK_SIZE;

        // 2. Erase block by block
        for (let i = 0; i < blocksToErase; i++)
        {
            const { highAdd, midAdd, lowAdd } = this.getAddressBytes(addPtr);
            console.log(`Erasing block ${i + 1}/${blocksToErase} at 0x${addPtr.toString(16)}...`);

            if (!await this.writeCommandPacket(this.CMD_ERASE_EEPROM_BLOCK, highAdd, midAdd, lowAdd, null))
            {
                console.error(`Failed to erase EEPROM block at address 0x${addPtr.toString(16)}`);
                return false; // Abort on single block failure
            }
            addPtr += this.EEPROM_BLOCK_SIZE; // Increment to next 64K block boundary
        }
        console.log(`Voice bank erase completed for offset 0x${bankOffset.toString(16)}.`);
        return true;
    }

    /**
     * Write the count of voice banks/phrases to the configuration area
     * Assumes config is in the first sector (0x000000)
     * @param {number} count - The count value to write
     * @returns {Promise<boolean>} True on success, false on failure
     */
    async writeVoiceBankCount(count)
    {
        const configBlock1 = new Uint8Array(this.EEPROM_CONFIG_BLOCK_SIZE);
        const configBlock2 = new Uint8Array(this.EEPROM_CONFIG_BLOCK_SIZE); // Assuming two blocks for config

        try
        {
            console.log("Reading existing configuration blocks...");
            // Read Block 1 - Send command, then check response
            if (!await this.writeCommandPacket(this.CMD_READ_EEPROM_PAGE, 0x00, 0x00, 0x00, null))
            {
                 throw new Error("Failed to send read command for config block 1");
            }
            // The response data is now in this.packet due to writeCommandPacket's internal read
            configBlock1.set(this.packet.subarray(this.PACKET_HEADER_SIZE, this.PACKET_HEADER_SIZE + this.EEPROM_CONFIG_BLOCK_SIZE));

            // Read Block 2
            if (!await this.writeCommandPacket(this.CMD_READ_EEPROM_PAGE, 0x00, 0x00, this.EEPROM_CONFIG_BLOCK_SIZE, null))
            {
                  throw new Error("Failed to send read command for config block 2");
            }
            configBlock2.set(this.packet.subarray(this.PACKET_HEADER_SIZE, this.PACKET_HEADER_SIZE + this.EEPROM_CONFIG_BLOCK_SIZE));

            console.log("Configuration blocks read.");

            // Update the voice bank count parameter
            configBlock1[this.EEPROM_CONFIG_BLOCK_SIZE - 1] = count;
            console.log(`Updating voice bank count parameter to: ${count}`);

            // Erase the configuration sector
            console.log("Clearing protection and erasing config sector (0x000000)...");
            if (!await this.writeCommandPacket(this.CMD_EEPROM_CLEAR_PROTECTION, 0, 0, 0, null))
            {
                 throw new Error("Failed to clear EEPROM protection before config write.");
            }
            if (!await this.writeCommandPacket(this.CMD_ERASE_EEPROM_BLOCK, 0, 0, 0, null))
            {
                 throw new Error("Failed to erase EEPROM config sector (0x000000).");
            }
            console.log("Config sector erased.");

            // Write back the updated configuration blocks
            console.log("Writing updated configuration blocks back...");
            if (!await this.writeCommandPacket(this.CMD_WRITE_EEPROM_PAGE, 0x00, 0x00, 0x00, configBlock1))
            {
                  throw new Error("Failed to write updated config block 1.");
            }
            if (!await this.writeCommandPacket(this.CMD_WRITE_EEPROM_PAGE, 0x00, 0x00, this.EEPROM_CONFIG_BLOCK_SIZE, configBlock2))
            {
                  throw new Error("Failed to write updated config block 2.");
            }

            console.log("Voice bank count updated successfully.");
            return true;
        }
        catch (error)
        {
            console.error("Error writing voice bank count:", error);
            return false;
        }
    }

    /**
     * Write a single voice map entry (start/end address)
     * @param {number} index - The voice index (0-based)
     * @param {number} startAdd - Start address of the voice data
     * @param {number} endAdd - End address of the voice data
     * @param {number} mapBaseOffset - Base address where the map starts (e.g., bank offset)
     * @returns {Promise<boolean>} True on success, false on failure
     */
    async writeVoiceMapEntry(index, startAdd, endAdd, mapBaseOffset)
    {
        const mapEntryAddress = mapBaseOffset + (index * this.EEPROM_VOICE_MAP_ENTRY_SIZE);
        const dataBlock = new Uint8Array(this.EEPROM_VOICE_MAP_ENTRY_SIZE);

        dataBlock.fill(0xff); // Fill block with 0xFF initially

        // Deconstruct start address
        let { highAdd: startHigh, midAdd: startMid, lowAdd: startLow } = this.getAddressBytes(startAdd);
        dataBlock[0] = startLow;
        dataBlock[1] = startMid;
        dataBlock[2] = startHigh;

        // Deconstruct end address
        let { highAdd: endHigh, midAdd: endMid, lowAdd: endLow } = this.getAddressBytes(endAdd);
        dataBlock[3] = endLow;
        dataBlock[4] = endMid;
        dataBlock[5] = endHigh;

        // Get address bytes for writing the map entry itself
        const { highAdd: mapHigh, midAdd: mapMid, lowAdd: mapLow } = this.getAddressBytes(mapEntryAddress);

        try
        {
            if (!await this.writeCommandPacket(this.CMD_WRITE_EEPROM_PAGE, mapHigh, mapMid, mapLow, dataBlock))
            {
                 throw new Error(`Failed writing voice map entry at index ${index} (address 0x${mapEntryAddress.toString(16)})`);
            }
            return true;
        }
        catch (error)
        {
            console.error("Error writing voice map entry:", error);
            return false;
        }
    }

    /**
     * Fetch a voice file (binary) and write it to the device EEPROM
     * @param {string} voiceFileUrl - URL path to the binary voice file
     * @param {number} startAddress - Address in EEPROM to start writing the file data
     * @returns {Promise<number>} The number of bytes written, or 0 on failure
     */
    async writeVoiceFile(voiceFileUrl, startAddress)
    {
        try
        {
            // Fetch binary audio file
            const response = await fetch(voiceFileUrl);
            if (!response.ok)
            {
                throw new Error(`Failed to fetch voice file: ${response.statusText} (URL: ${voiceFileUrl})`);
            }

            const arrayBuffer = await response.arrayBuffer();
            const fileData = new Uint8Array(arrayBuffer);
            const length = fileData.length;

            if (length === 0)
            {
                console.warn(`Voice file is empty: ${voiceFileUrl}`);
                return 0; // Nothing to write
            }

            let addPtr = startAddress;
            let fileIndex = 0;
            const block = new Uint8Array(this.BUFFER_SIZE); // Use standard buffer size for writes

            // Write data in chunks
            while (fileIndex < length)
            {
                const bytesToCopy = Math.min(this.BUFFER_SIZE, length - fileIndex);
                const chunkData = fileData.subarray(fileIndex, fileIndex + bytesToCopy);

                block.fill(0xFF); // Erased state for padding
                block.set(chunkData); // Copy chunk data to start of buffer

                const { highAdd, midAdd, lowAdd } = this.getAddressBytes(addPtr);
                if (!await this.writeCommandPacket(this.CMD_WRITE_EEPROM_PAGE, highAdd, midAdd, lowAdd, block)) // Send full buffer
                {
                     throw new Error(`Failed to write voice data chunk at address 0x${addPtr.toString(16)}`);
                }

                addPtr += bytesToCopy; // Increment address by actual bytes written
                fileIndex += bytesToCopy;
            }
            return length; // Return total bytes written
        }
        catch (error)
        {
            console.error(`Error writing voice file ${voiceFileUrl}:`, error);
            return 0; // Indicate failure
        }
    }
} // End PicUsbInterface Class


//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// --- UI Logic and Application Flow ---
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

// Instantiate the interface
const deviceInterface = new PicUsbInterface();

// --- DOM Element Caching (executed after DOM loaded) ---
let firmwareSelect = null;
let voicePackSelect = null;
let firmwareCheckbox = null;
let voiceCheckbox = null;
let downloadButton = null;
let clearButton = null;
let statusTextArea = null;
let voiceBankRadios = null;

/**
 * Updates the status text area, ensuring it scrolls to the bottom.
 * @param {string} messageText - The text to append.
 */
function updateTextArea(messageText)
{
    if (statusTextArea)
    {
        statusTextArea.value += messageText;
        statusTextArea.scrollTop = statusTextArea.scrollHeight; // Auto-scroll
    }
    else
    {
        // console.warn("Status text area not available for message:", messageText);
    }
}

/**
 * Clears the status text area content.
 */
function clearTextArea()
{
    if (statusTextArea)
    {
        statusTextArea.value = "";
    }
}

/**
 * Populates Firmware and Voice Pack dropdowns from config.xml.
 */
async function populateDownloads()
{
    try
    {
        const response = await fetch("config.xml");
        if (!response.ok)
        {
            throw new Error(`Failed to fetch config.xml: ${response.statusText}`);
        }
        const xmlText = await response.text();
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlText, "text/xml");

        // Populate Firmware Dropdown
        let group = xmlDoc.querySelector("firmware");
        if (group && firmwareSelect)
        {
            let fileList = group.querySelectorAll("file");
            fileList.forEach((file) =>
            {
                const option = document.createElement("option");
                option.value = file.textContent; // Use filename as value
                option.text = file.textContent;
                firmwareSelect.appendChild(option);
            });
        }
        else
        {
             updateTextArea("Warning: Could not find <firmware> section in config.xml or dropdown element.\n");
        }


        // Populate Voice Pack Dropdown
        group = xmlDoc.querySelector("voice");
        if (group && voicePackSelect)
        {
            let fileList = group.querySelectorAll("file");
            fileList.forEach((file) =>
            {
                const option = document.createElement("option");
                option.value = file.textContent; // Use filename as value
                option.text = file.textContent;
                voicePackSelect.appendChild(option);
            });
        }
        else
        {
             updateTextArea("Warning: Could not find <voice> section in config.xml or dropdown element.\n");
        }
    }
    catch (error)
    {
        console.error("Error populating downloads from config.xml:", error);
        updateTextArea(`ERROR: Could not load configuration: ${error.message}\n`);
    }
}

/**
 * Handles the change event for the firmware dropdown.
 */
function updateFirmwareSelection()
{
    if (!firmwareSelect || !firmwareCheckbox) return;

    if (firmwareSelect.value === "")
    {
        firmwareCheckbox.checked = false;
        return;
    }
    const firmwareFileName = firmwareSelect.value;
    firmwareCheckbox.checked = true;
    updateTextArea(`Using firmware: ${firmwareFileName}\n`);
}

/**
 * Handles the change event for the voice pack dropdown.
 */
function updateVoiceSelection()
{
    if (!voicePackSelect || !voiceCheckbox) return;

    if (voicePackSelect.value === "")
    {
        voiceCheckbox.checked = false;
        return;
    }
    const voicePackFileName = voicePackSelect.value;
    voiceCheckbox.checked = true;

    // Auto-select Bank 1 if nothing is checked yet
    let bankSelected = false;
    if (voiceBankRadios)
    {
         for (const radio of voiceBankRadios)
         {
            if (radio.checked)
            {
                bankSelected = true;
                break;
            }
         }
         if (!bankSelected)
         {
             const bank1Radio = document.getElementById("rbBank1");
             if (bank1Radio) bank1Radio.checked = true;
         }
    }

    updateTextArea(`Using voice pack: ${voicePackFileName}\n`);
}

/**
 * Connects to the HID device, requesting permission if needed.
 * @returns {Promise<boolean>} True if connection successful, false otherwise.
 */
async function connectDevice()
{
    updateTextArea("Attempting to connect to device...\n");
    try
    {
        // Try detecting first
        let deviceAvailable = await deviceInterface.detectDevice();

        if (!deviceAvailable)
        {
             updateTextArea("No pre-authorized device found. Please select device...\n");
             deviceAvailable = await deviceInterface.requestDevice();
        }

        if (deviceAvailable)
        {
            const deviceOpened = await deviceInterface.openDevice();
            if (deviceOpened)
            {
                updateTextArea("Device connected successfully.\n");
                return true;
            }
            else
            {
                updateTextArea("ERROR: Device found but failed to open.\n");
                await deviceInterface.closeDevice(); // Ensure cleanup
                return false;
            }
        }
        else
        {
            updateTextArea("ERROR: No compatible device selected or found.\n");
            return false;
        }
    }
    catch (error)
    {
        console.error("Error connecting to device:", error);
        updateTextArea(`ERROR connecting: ${error.message}\n`);
        await deviceInterface.closeDevice(); // Ensure cleanup on error
        return false;
    }
}

/**
 * Disconnects from the HID device.
 * @returns {Promise<boolean>} True if disconnected ok or already disconnected, false on error closing.
 */
async function disconnectDevice()
{
    if (deviceInterface.device && deviceInterface.device.opened)
    {
        updateTextArea("Disconnecting device...\n");
        const success = await deviceInterface.closeDevice();
        if (success)
        {
             updateTextArea("Device disconnected.\n");
        }
        else
        {
             updateTextArea("Warning: Error occurred during device disconnection.\n");
             return false; // Indicate error during close
        }
    }
    else
    {
        updateTextArea("Device already disconnected or not connected.\n");
    }
    return true; // Indicate disconnected state
}

/**
 * Gets the value of the selected voice bank radio button.
 * @returns {string | null} The value ("bank1", "bank2", "bank3") or null if none selected.
 */
function getVoiceBankSelection()
{
    if (!voiceBankRadios) return null;

    for (const radio of voiceBankRadios)
    {
        if (radio.checked)
        {
            return radio.value; // Return the value attribute
        }
    }
    return null; // None selected
}

/**
 * Processes a voice pack XML file, writing contained voice files and map entries.
 * @param {string} voicePackXmlFile - URL path to the voice pack XML definition.
 * @param {number} bankOffset - The starting address of the target voice bank.
 * @returns {Promise<{success: boolean, count: number}>} Object indicating success and number of phrases processed.
 */
async function processVoicePack(voicePackXmlFile, bankOffset)
{
    let phrasesProcessed = 0;
    try
    {
        updateTextArea(`Fetching voice pack definition: ${voicePackXmlFile}...\n`);
        const response = await fetch(voicePackXmlFile);
        if (!response.ok)
        {
            throw new Error(`Failed to fetch voice pack XML: ${response.statusText}`);
        }
        const xmlText = await response.text();
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlText, "text/xml");

        const pathElement = xmlDoc.querySelector("path");
        const path = pathElement ? pathElement.textContent.trim() : "";
        if (!path)
        {
            console.warn("No <path> element found in voice pack XML. Assuming relative path.");
        }

        const phrases = xmlDoc.querySelectorAll("phrase");
        if (phrases.length === 0)
        {
             updateTextArea("Warning: No <phrase> elements found in the voice pack XML.\n");
             return { success: true, count: 0 };
        }

        updateTextArea(`Found ${phrases.length} phrases. Starting voice data write...\n`);

        let currentAddressPtr = bankOffset + deviceInterface.EEPROM_VOICE_MAP_OFFSET;
        const mapBaseAddress = bankOffset;

        for (let i = 0; i < phrases.length; i++)
        {
            const phrase = phrases[i];
            const indexElement = phrase.querySelector("index");
            const fileElement = phrase.querySelector("file");

            if (!indexElement || !fileElement)
            {
                updateTextArea(`Warning: Skipping phrase ${i + 1} - missing index or file tag.\n`);
                continue;
            }

            const index = parseInt(indexElement.textContent.trim(), 10);
            const fileName = fileElement.textContent.trim();
            const filePath = (path ? `${path.replace(/\/$/, '')}/${fileName}` : fileName);

            updateTextArea(`  Writing file ${i + 1}/${phrases.length} (${fileName})... `);

            const startAdd = currentAddressPtr;
            const bytesWritten = await deviceInterface.writeVoiceFile(filePath, startAdd);

            if (bytesWritten === 0)
            {
                updateTextArea(`ERROR!\n`);
                throw new Error(`Failed to write voice file: ${fileName}`);
            }

            const endAdd = startAdd + bytesWritten - 1;

            if (!await deviceInterface.writeVoiceMapEntry(index, startAdd, endAdd, mapBaseAddress))
            {
                 updateTextArea(`ERROR writing map entry!\n`);
                 throw new Error(`Failed to write map entry for index ${index}`);
            }

            updateTextArea(`OK (${bytesWritten} bytes)\n`);
            currentAddressPtr = endAdd + 1;
            phrasesProcessed++;
        }

        updateTextArea(`Voice pack processing complete. ${phrasesProcessed} phrases written.\n`);
        return { success: true, count: phrasesProcessed };
    }
    catch (error)
    {
        console.error("Error processing voice pack:", error);
        updateTextArea(`ERROR during voice pack processing: ${error.message}\n`);
        return { success: false, count: phrasesProcessed };
    }
}


/**
 * Helper function to handle firmware programming logic.
 * @returns {Promise<boolean>} True on success/skip, false on failure.
 */
async function programFirmware()
{
    if (!firmwareCheckbox || !firmwareSelect) return false;

    if (!firmwareCheckbox.checked)
    {
        updateTextArea("Skipping firmware download (checkbox unchecked).\n");
        return true; // Skipped successfully
    }

    const firmwareFileName = firmwareSelect.value;
    if (!firmwareFileName)
    {
        updateTextArea("Skipping firmware download (no file selected).\n");
        firmwareCheckbox.checked = false;
        return true; // Skipped successfully
    }

    updateTextArea(`Starting firmware download: ${firmwareFileName}...\n`);
    const firmwarePath = `firmware/${firmwareFileName}`; // Assuming 'firmware' subfolder

    const success = await deviceInterface.writeImage(firmwarePath);

    if (success)
    {
        updateTextArea("Firmware download completed successfully.\n");
        return true;
    }
    else
    {
        updateTextArea("ERROR: Firmware download failed.\n");
        return false; // Indicate failure
    }
}

/**
 * Helper function to handle voice pack programming logic.
 * @returns {Promise<boolean>} True on success/skip, false on failure.
 */
async function programVoicePack()
{
    if (!voiceCheckbox || !voicePackSelect) return false;

    if (!voiceCheckbox.checked)
    {
        updateTextArea("Skipping voice pack download (checkbox unchecked).\n");
        return true; // Skipped successfully
    }

    const voicePackFileName = voicePackSelect.value;
    if (!voicePackFileName)
    {
        updateTextArea("Skipping voice pack download (no file selected).\n");
        voiceCheckbox.checked = false;
        return true; // Skipped successfully
    }

    const voiceBankValue = getVoiceBankSelection();
    if (!voiceBankValue)
    {
        updateTextArea("ERROR: No voice bank selected. Cannot download voice pack.\n");
        return false; // Failure - requires bank selection
    }

    let bankOffset = 0;
    switch (voiceBankValue)
    {
        case "bank1": bankOffset = deviceInterface.VOICE_BANK_1_OFFSET; break;
        case "bank2": bankOffset = deviceInterface.VOICE_BANK_2_OFFSET; break;
        case "bank3": bankOffset = deviceInterface.VOICE_BANK_3_OFFSET; break;
        default:
            updateTextArea(`ERROR: Unknown voice bank value selected: ${voiceBankValue}\n`);
            return false;
    }

    updateTextArea(`Targeting Voice Bank at offset 0x${bankOffset.toString(16)}.\n`);

    // 1. Erase the target voice bank
    updateTextArea("Erasing target voice bank (this may take a while)...");
    const eraseSuccess = await deviceInterface.eraseVoiceBank(bankOffset);
    if (!eraseSuccess)
    {
        updateTextArea("ERROR: Failed to erase voice bank.\n");
        return false; // Abort if erase fails
    }
    updateTextArea(" completed.\n");

    // 2. Process the voice pack XML and write files/map
    updateTextArea(`Starting voice pack download: ${voicePackFileName}...\n`);
    const voicePath = `voice/${voicePackFileName}`; // Assuming 'voice' subfolder
    const processResult = await processVoicePack(voicePath, bankOffset);

    if (!processResult.success)
    {
        updateTextArea("ERROR: Failed during voice pack processing.\n");
        return false; // Abort if processing fails
    }

    // 3. Update voice bank count parameter
    let bankCountParameter = 0;
     switch (voiceBankValue)
    {
        case "bank1": bankCountParameter = 100; break; // Example counts
        case "bank2": bankCountParameter = 110; break;
        case "bank3": bankCountParameter = 111; break;
    }

    if (bankCountParameter > 0)
    {
        updateTextArea(`Updating voice configuration parameter to ${bankCountParameter}...\n`);
        const countUpdateSuccess = await deviceInterface.writeVoiceBankCount(bankCountParameter);
        if (!countUpdateSuccess)
        {
             updateTextArea("Warning: Failed to update voice bank count parameter after download.\n");
        }
        else
        {
             updateTextArea("Voice configuration parameter updated.\n");
        }
    }
    else
    {
         updateTextArea("Skipping voice count parameter update (no count determined).\n");
    }


    updateTextArea("Voice pack download process finished.\n");
    return true; // Indicate overall success
}

/**
 * Main function to program the device based on UI selections.
 * Handles connect, mode switching, calling helpers, and disconnect.
 */
async function programDevice()
{
    if (!firmwareCheckbox || !voiceCheckbox || !downloadButton)
    {
         console.error("UI elements not ready for programming.");
         updateTextArea("ERROR: UI not initialized correctly.\n");
         return;
    }

    if (!firmwareCheckbox.checked && !voiceCheckbox.checked)
    {
        updateTextArea("Nothing selected to download. Check Firmware or Voice.\n");
        return; // Nothing to do
    }

    let deviceWasConnected = false;

    try
    {
        downloadButton.disabled = true;
        updateTextArea("--- Starting Programming Sequence ---\n");

        if (!await connectDevice())
        {
            throw new Error("Device connection failed. Aborting.");
        }
        deviceWasConnected = true;

        updateTextArea("Setting device to Programming Mode...\n");
        if (!await deviceInterface.writeMode(PROG_MODE))
        {
             throw new Error("Failed to set device to Programming Mode.");
        }

        let firmwareSuccess = await programFirmware();
        if (!firmwareSuccess && firmwareCheckbox.checked)
        {
             throw new Error("Firmware programming failed. Aborting sequence.");
        }

        let voiceSuccess = true;
        if (firmwareSuccess) // Only proceed if firmware was successful or skipped
        {
             voiceSuccess = await programVoicePack();
             if (!voiceSuccess && voiceCheckbox.checked)
             {
                  throw new Error("Voice pack programming failed. Aborting sequence.");
             }
        }


        updateTextArea("--- Programming Sequence Finished ---\n");

    }
    catch (error)
    {
        console.error("Error during programming sequence:", error);
        updateTextArea(`SEQUENCE ERROR: ${error.message}\n`);
        updateTextArea("--- Programming Sequence Aborted ---\n");
    }
    finally
    {
        // --- Cleanup ---
        if (deviceWasConnected && deviceInterface.device && deviceInterface.device.opened)
        {
            updateTextArea("Attempting cleanup: Setting Run Mode and Disconnecting...\n");
            try
            {
                if (!await deviceInterface.writeMode(RUN_MODE))
                {
                     updateTextArea("Warning: Failed to set device back to Run Mode.\n");
                }
                await disconnectDevice();
            }
            catch (cleanupError)
            {
                console.error("Error during device cleanup:", cleanupError);
                updateTextArea(`ERROR during cleanup: ${cleanupError.message}\n`);
            }
        }
        else if (deviceWasConnected)
        {
             updateTextArea("Device was connected but seems closed already. Skipping final mode set.\n");
             // Ensure flags are fully reset if closeDevice wasn't called cleanly
             deviceInterface.deviceDetected = false;
             deviceInterface.device = null;
             deviceInterface.isReading = false;
        }
        else
        {
             updateTextArea("Device was not connected. No cleanup needed.\n");
        }


        if (downloadButton)
        {
            downloadButton.disabled = false;
        }
        updateTextArea("---------------------------------------\n");
    }
}


// --- Event Listener Setup (runs after DOM is fully loaded) ---
document.addEventListener('DOMContentLoaded', () =>
{
    // Cache DOM elements
    firmwareSelect = document.getElementById('ddFirmware');
    voicePackSelect = document.getElementById('ddVoicePack');
    firmwareCheckbox = document.getElementById("cbFirmware");
    voiceCheckbox = document.getElementById("cbVoice");
    downloadButton = document.getElementById("btnDownload");
    clearButton = document.getElementById("btnClearStatus");
    statusTextArea = document.getElementById("statusArea");
    voiceBankRadios = document.getElementsByName('voiceBank');

    // Basic check if essential elements were found
    if (!firmwareSelect || !voicePackSelect || !firmwareCheckbox || !voiceCheckbox || !downloadButton || !clearButton || !statusTextArea || !voiceBankRadios)
    {
         console.error("FATAL: One or more essential UI elements not found in the DOM.");
         // Attempt to update text area if it exists, otherwise just log
         const initMsg = "FATAL ERROR: UI elements missing. Cannot initialize application.\nPlease check the HTML structure and element IDs.\n";
         if (statusTextArea) { updateTextArea(initMsg); } else { console.error(initMsg); }
         if (downloadButton) downloadButton.disabled = true;
         return; // Stop initialization
    }


    // Populate dropdowns
    populateDownloads();

    // Attach event listeners
    clearButton.addEventListener('click', clearTextArea);
    firmwareSelect.addEventListener('change', updateFirmwareSelection);
    voicePackSelect.addEventListener('change', updateVoiceSelection);
    downloadButton.addEventListener('click', programDevice);

    updateTextArea("Web Interface Initialized.\nSelect options and click Download.\n");
    console.log("Evo USB Interface Initialized.");
});