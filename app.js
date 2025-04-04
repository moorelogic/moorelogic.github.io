	const RUN_MODE = 0;
	const PROG_MODE = 1;

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
			this.CRYPT_KEY = "ABCDEFGHIJKLMNOP";
			this.CRYPT_IV = "ABCDEFGHIJKLMNOP";
			this.USING_ENCRYPTION = false;

		// Interface commands
			this.CMD_PROGRAM_MEM_BLOCK = 1;
			this.CMD_READ_EEPROM_PAGE = 2;
			this.CMD_EEPROM_CLEAR_PROTECTION = 3;
			this.CMD_ERASE_EEPROM_BLOCK = 4; // 64K
			this.CMD_WRITE_EEPROM_PAGE = 5;
			this.CMD_SET_MODE = 6;
			this.CMD_ACK = 13;

		// HID related
			this.device = null;
			this.deviceDetected = false;
			this.packet = new Uint8Array(this.PACKET_SIZE);
			this.voiceFileList = [];
		}

		/**
		 * Helper to split address into bytes
		 */
		getAddressBytes(add)
		{
			const highAdd = (add >> 16) & 0xff;
			const midAdd = (add >> 8) & 0xff;
			const lowAdd = add & 0xff;
			return { highAdd, midAdd, lowAdd };
		}

		/**
		 * Fill an array with a specific value
		 */
		fillArray(value, dataAry)
		{
			for (let i = 0; i < dataAry.length; i++)
			{
				dataAry[i] = value;
			}
		}

		/**
		 * Request user permission to access HID device
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
					return true;
				}
				return false;
			}
			catch (error)
			{
				console.error("Error requesting HID device:", error);
				return false;
			}
		}

		/**
		 * Check for already paired devices
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
						return true;
					}
				}
				return false;
			}
			catch (error)
			{
				console.error("Error detecting HID device:", error);
				return false;
			}
		}

		/**
		 * Open connection to the device
		 */
		async openDevice()
		{
			if (!this.deviceDetected || !this.device)
			{
				return false;
			}

			try
			{
				if (!this.device.opened)
				{
					await this.device.open();
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
		 */
		async closeDevice()
		{
			if (this.device && this.device.opened)
			{
				try
				{
					await this.device.close();
					return true;
				}
				catch (error)
				{
					console.error("Error closing HID device:", error);
				}
			}
			
			return false;
		}

		/**
		 * Read a data packet from the device
		 */
		async readDataPacket()
		{
			if (!this.deviceDetected || !this.device || !this.device.opened)
			{
				return false;
			}

			return new Promise((resolve) =>
			{
				this.device.addEventListener("inputreport", event =>
				{
					const data = new Uint8Array(event.data.buffer);
					for (let i = 0; i < data.length; i++)
					{
						this.packet[i] = data[i];
					}
					resolve(true);
				},{ once: true });
			});
		}

		/**
		 * Write a data packet to the device
		 */
		async writeDataPacket()
		{
			if (!this.deviceDetected || !this.device || !this.device.opened)
			{
				return false;
			}

			try
			{
				await this.device.sendReport(0, this.packet);
				return true;
			}
			catch (error)
			{
				console.error("Error writing data packet:", error);
				return false;
			}
		}

		/**
		 * Write a command packet to the device
		 */
		async writeCommandPacket(cmd, highAdd, midAdd, lowAdd, data)
		{    
		// Load and send data packet
			this.packet[0] = cmd;
			this.packet[1] = highAdd;
			this.packet[2] = midAdd;
			this.packet[3] = lowAdd;
			if (data === null || data === undefined)
			{
				this.packet[4] = 0; // No data payload
			}
			else
			{
				this.packet[4] = data.length;
				for (let i = 0; i < data.length; i++)
				{
					this.packet[i + 5] = data[i];
				}
			}

			await this.writeDataPacket();
			await this.readDataPacket();
			
			if (this.packet[0] === this.CMD_ACK)
			{
				return true;
			}
			else
			{
				return false;
			}
		}

		/**
		* Decrypt data using Web Crypto API
		*/
		async decryptData(encryptedData)
		{
			const encoder = new TextEncoder();
			const keyData = encoder.encode(this.CRYPT_KEY);
			const ivData = encoder.encode(this.CRYPT_IV);
			//const ivData = new Uint8Array([ /* 16 bytes of data */ ]);

			const key = await window.crypto.subtle.importKey
			(
				'raw',
				keyData,
				{ name: 'AES-CBC' },
				false,
				['decrypt']
			);

			const decrypted = await window.crypto.subtle.decrypt
			(
				{ name: 'AES-CBC', iv: ivData },
				key,
				encryptedData
			);

			return new TextDecoder().decode(decrypted);
		}

		/**
		 * Load encrypted records from a file
		 */
		async loadEncryptedRecordSet(file)
		{
			try
			{
				const response = await fetch(file);
				const encryptedData = await response.arrayBuffer();
				const decryptedText = await this.decryptData(encryptedData);

			// Split on carriage return and process lines
				let rawSet = decryptedText.split('\n');
				let recordSet = [];

				for (let i = 0; i < rawSet.length; i++)
				{
					if (rawSet[i].length > 0 && rawSet[i].substring(0, 1) === ':')
					{
						recordSet.push(rawSet[i].substring(1));
					}
				}

				return recordSet;
			}
			catch (error)
			{
				console.error("Error loading encrypted records:", error);
				return [];
			}
		}

		/**
		 * Load records from a file
		 */
		async loadRecordSet(file) // file object
		{
			try
			{
				const text = await file.text();

			// Split on newline and process lines
				let rawSet = text.split('\n');
				let recordSet = [];

				for (let i = 0; i < rawSet.length; i++)
				{
					if (rawSet[i].length > 0 && rawSet[i].substring(0, 1) === ':')
					{
						recordSet.push(rawSet[i].substring(1, rawSet[i].length - 1));
						let msg = rawSet[i];
					}
				}

				return recordSet;
			}
			catch (error)
			{
				console.error("Error loading records:", error);
				return [];
			}
		}

		/**
		 * Parse a hex record string
		 */
		parseRecord(recordStr)
		{
			const record = {};

			record.dataSize = parseInt(recordStr.substring(0, 2), 16);
			record.data = new Uint8Array(record.dataSize);
			recordStr = recordStr.substring(2);

			record.midAdd = parseInt(recordStr.substring(0, 2), 16);
			recordStr = recordStr.substring(2);

			record.lowAdd = parseInt(recordStr.substring(0, 2), 16);
			recordStr = recordStr.substring(2);

			record.highAdd = 0x00;
			record.recType = parseInt(recordStr.substring(0, 2), 16);
			recordStr = recordStr.substring(2);

			for (let i = 0; i < record.dataSize; i++)
			{
				record.data[i] = parseInt(recordStr.substring(0, 2), 16);
				recordStr = recordStr.substring(2);
			}

			record.checkSum = parseInt(recordStr.substring(0, 2), 16);

			return record;
		}

		/**
		 * Parse a hex file
		 */
		async parseFile(firmwareFile)
		{
			let recordSet;

			if (this.USING_ENCRYPTION)
			{
				recordSet = await this.loadEncryptedRecordSet(firmwareFile);
			}
			else
			{
				recordSet = await this.loadRecordSet(firmwareFile);
			}

			const hexSet = [];

			for (let i = 0; i < recordSet.length; i++)
			{
				hexSet.push(this.parseRecord(recordSet[i]));
			}

			return hexSet;
		}

		/**
		 * Write firmware image to device
		 */
		async writeImage(firmwareFile)
		{
			const hexSet = await this.parseFile(firmwareFile);
			const hexQueue = [];
			const hexImage = new Uint8Array(this.IMAGE_SIZE);

			// Filter array for only memory data
			for (const hexData of hexSet)
			{
				if (hexData.recType === 0x00)
				{
					hexQueue.push(hexData);
				}
			}

			// Fill image with 0xFF (NOP)
			this.fillArray(0xFF, hexImage);

			// Load image with hex file data
			let hdAdd = 0;
			while (hexQueue.length > 0)
			{
				const hexData = hexQueue.shift();
				hdAdd = (hexData.highAdd * 0x1000) + (hexData.midAdd * 0x100) + hexData.lowAdd;

				for (let i = 0; i < hexData.dataSize; i++)
				{
					hexImage[hdAdd] = hexData.data[i];
					hdAdd++;
				}
			}

			const bufferCnt = Math.floor((hdAdd - this.PRG_START_ADD) / this.BUFFER_SIZE);
			const remCount = (hdAdd - this.PRG_START_ADD) % this.BUFFER_SIZE;
			const buffer = new Uint8Array(this.BUFFER_SIZE);
			let imgIndex = this.PRG_START_ADD;
			let add = imgIndex;

			// Process all complete buffers
			for (let bc = 0; bc < bufferCnt; bc++)
			{
				this.fillArray(0xFF, buffer);

				for (let i = 0; i < this.BUFFER_SIZE; i++)
				{
					buffer[i] = hexImage[imgIndex];
					imgIndex++;
				}

				// Write buffer to device
				const { highAdd, midAdd, lowAdd } = this.getAddressBytes(add);
				await this.writeCommandPacket(this.CMD_PROGRAM_MEM_BLOCK, highAdd, midAdd, lowAdd, buffer);
				add += this.BUFFER_SIZE;
			}

			// Write last remainder block if there is one
			if (remCount > 0)
			{
				this.fillArray(0xFF, buffer);

				for (let i = 0; i < remCount; i++)
				{
					buffer[i] = hexImage[imgIndex];
					imgIndex++;
				}

				const { highAdd, midAdd, lowAdd } = this.getAddressBytes(add);
				await this.writeCommandPacket(this.CMD_PROGRAM_MEM_BLOCK, highAdd, midAdd, lowAdd, buffer);
			}
		}

		/**
		 * Write mode byte to device
		 */
		async writeMode(mode)
		{
			const block = new Uint8Array(1);
			block[0] = mode;
			await this.writeCommandPacket(this.CMD_SET_MODE, 0, 0, 0, block);
		}

		/**
		 * Erase voice bank
		 */
		async eraseVoiceBank(memOffset)
		{
		// Clear protection
			await this.writeCommandPacket(this.CMD_EEPROM_CLEAR_PROTECTION, 0, 0, 0, null);

			let add = memOffset;

		// Voice bank = 0x100000 bytes, blocks are 0x10000, so 0x10 blocks to erase
			for (let i = 0; i < 0x10; i++)
			{
				const { highAdd, midAdd, lowAdd } = this.getAddressBytes(add);
				await this.writeCommandPacket(this.CMD_ERASE_EEPROM_BLOCK, highAdd, midAdd, lowAdd, null);
				add += 0x10000; // Increment to next 64K block
			}
		}

		/**
		 * Write voice bank count
		 */
		async writeVoiceBankCount(count)
		{
			const configBlock1 = new Uint8Array(32);
			const configBlock2 = new Uint8Array(32);

		// Read in both configuration blocks to preserve settings
			await this.writeCommandPacket(this.CMD_READ_EEPROM_PAGE, 0x00, 0x00, 0x00, configBlock1);
			for (let i = 0; i < 32; i++)
			{
				configBlock1[i] = this.packet[i + 5];
			}
			configBlock1[31] = count; // Update last parameter parNumVoiceBanks parameter to count value

			await this.writeCommandPacket(this.CMD_READ_EEPROM_PAGE, 0x00, 0x00, 0x20, configBlock2);
			for (let i = 0; i < 32; i++)
			{
				configBlock2[i] = this.packet[i + 5];
			}

		// Erase EEPROM sector and write back updated configuration blocks
			await this.writeCommandPacket(this.CMD_EEPROM_CLEAR_PROTECTION, 0, 0, 0, null);
			await this.writeCommandPacket(this.CMD_ERASE_EEPROM_BLOCK, 0, 0, 0, null);
			await this.writeCommandPacket(this.CMD_WRITE_EEPROM_PAGE, 0x00, 0x00, 0x00, configBlock1);
			await this.writeCommandPacket(this.CMD_WRITE_EEPROM_PAGE, 0x00, 0x00, 0x20, configBlock2);
		}

		/**
		 * Write voice map entry
		 */
		async writeVoiceMapEntry(index, startAdd, endAdd, offset)
		{
			const mapPtr = (index * 6) + offset;
			const dataBlock = new Uint8Array(6);

		// Load start and end address in low, mid, high order
			this.fillArray(0xff, dataBlock);

			let { highAdd, midAdd, lowAdd } = this.getAddressBytes(startAdd);
			dataBlock[0] = lowAdd;
			dataBlock[1] = midAdd;
			dataBlock[2] = highAdd;

			({ highAdd, midAdd, lowAdd } = this.getAddressBytes(endAdd));
			dataBlock[3] = lowAdd;
			dataBlock[4] = midAdd;
			dataBlock[5] = highAdd;

		// Map index address
			({ highAdd, midAdd, lowAdd } = this.getAddressBytes(mapPtr));
			await this.writeCommandPacket(this.CMD_WRITE_EEPROM_PAGE, highAdd, midAdd, lowAdd, dataBlock);
		}

		/**
		 * Write voice file to device
		 */
		async writeVoiceFile(file, add)
		{
			try
			{
			// Fetch binary audio file
				const response = await fetch(file);
				if (!response.ok)
				{
					throw new Error(`Failed to fetch file: ${response.statusText}`);
				}

				const arrayBuffer = await response.arrayBuffer();
				const fileData = new Uint8Array(arrayBuffer);
				const length = fileData.length;

			// Write complete blocks to external flash
				const blockCount = Math.floor(length / 32);
				const fullBlock = new Uint8Array(32);

				let fileIndex = 0;
				for (let i = 0; i < blockCount; i++)
				{
				// Load 32 bytes of data into each block
					for (let j = 0; j < 32; j++)
					{
						fullBlock[j] = fileData[fileIndex++];
					}

				// Write 32 byte block into external flash starting at address
					const { highAdd, midAdd, lowAdd } = this.getAddressBytes(add);
					await this.writeCommandPacket(this.CMD_WRITE_EEPROM_PAGE, highAdd, midAdd, lowAdd, fullBlock);
					add += 32; // Increment address one data block
				}

			// Write remainder of bytes to external flash
				const rem = length % 32;
				if (rem > 0)
				{
					const partialBlock = new Uint8Array(rem);
					for (let i = 0; i < rem; i++)
					{
						partialBlock[i] = fileData[fileIndex++];
					}

					const { highAdd, midAdd, lowAdd } = this.getAddressBytes(add);
					await this.writeCommandPacket(this.CMD_WRITE_EEPROM_PAGE, highAdd, midAdd, lowAdd, partialBlock);
				}

				return length;
			}
			catch (error)
			{
				console.error("Error writing voice file:", error);
				return 0;
			}
		}
	}

	const deviceInterface = new PicUsbInterface();

	// Updates the file name in the firmware text box and adds it to the textarea
	const firmwareInput = document.getElementById('firmwareFile');
	firmwareInput.addEventListener('change', updateFirmwareFileName);

	function updateFirmwareFileName()
	{
		const fileInput = document.getElementById('firmwareFile');
		const fileNameInput = document.getElementById('firmwareFileName');
		const textArea = document.querySelector("textarea");
		const checkbox = document.getElementById("cbFirmware");

		// Update the text box with the selected file name
		fileNameInput.value = fileInput.files.length > 0 ? fileInput.files[0].name : '';

		// Add the file name to the textarea
		if (fileInput.files.length > 0)
		{
			textArea.value += `Using firmware: ${fileInput.files[0].name}\n`;
			checkbox.checked = true;
		}
	}

	// Updates the file name in the voice select text box and adds it to the textarea
	const voiceInput = document.getElementById('voiceFile');
	voiceInput.addEventListener('change', updateVoiceFileName);

	function updateVoiceFileName()
	{
		const fileInput = document.getElementById('voiceFile');
		const fileNameInput = document.getElementById('voiceFileName');
		const textArea = document.querySelector("textarea");
		const checkbox = document.getElementById("cbVoice");
		const radioInput = document.getElementById("rbBank2");

		// Update the text box with the selected file name
		fileNameInput.value = fileInput.files.length > 0 ? fileInput.files[0].name : '';

		// Add the file name to the textarea
		if (fileInput.files.length > 0)
		{
			textArea.value += `Voice: ${fileInput.files[0].name}\n`;
			checkbox.checked = true;
			radioInput.checked = true;
		}
	}

	// Clears the text area content
	const clearButton = document.querySelector(".clear-button");
	clearButton.addEventListener('click', clearTextArea);

	function clearTextArea()
	{
		const textArea = document.querySelector("textarea");
		textArea.value = "";
	}

	// connect and open HID device
	async function connectDevice()
	{
		const textArea = document.querySelector("textarea");
		const deviceConnected = await deviceInterface.requestDevice();
		if (deviceConnected)
		{
			const deviceOpened = await deviceInterface.openDevice();
			if (deviceOpened)
			{
				textArea.value += `Device connected\n`;
			}
			else
			{
				textArea.value += `Device failed to connect\n`;
			}
		}
		else
		{
			textArea.value += `Device failed to connect\n`;
		}
	}

	// close HID device
	async function disconnectDevice()
	{
		const textArea = document.querySelector("textarea");
		const deviceDisconnected = await deviceInterface.closeDevice();
		if (deviceDisconnected)
		{
			textArea.value += `Device disconnected\n`;
		}
		else
		{
			textArea.value += `Device failed to disconnect\n`;
		}
	}

	// program HID device
	const downloadButton = document.getElementById("btnDownload");
	downloadButton.addEventListener('click', programDevice);

	async function programDevice()
	{
		const textArea = document.querySelector("textarea");
		const file = document.getElementById("firmwareFile").files[0];
		const fileNameInput = document.getElementById('firmwareFileName');
		const firmwareCheckbox = document.getElementById("cbFirmware");
		const voiceCheckbox = document.getElementById("cbVoice");
		document.getElementById('btnDownload').disabled = true;

		await connectDevice();
		if (deviceInterface.deviceDetected)
		{
			await deviceInterface.writeMode(PROG_MODE);

		// program firmware
			if (firmwareCheckbox.checked)
			{
			// program the device and update status
				textArea.value += `Downloading firmware...`;
				await deviceInterface.writeImage(file);
				textArea.value += `completed\n`;
			}
			else
			{
				textArea.value += `Skipping firmware download\n`;
			}

		// program voice set
			if (voiceCheckbox.checked)
			{
			}
			else
			{
				textArea.value += `Skipping voice download\n`;
			}
		}

		await deviceInterface.writeMode(RUN_MODE);
		await disconnectDevice();
		document.getElementById('btnDownload').disabled = false;
	}