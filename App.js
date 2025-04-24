import React, { useState, useEffect, useRef } from "react";
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  PermissionsAndroid,
  Platform,
  Alert,
  Animated,
} from "react-native";
import { Buffer } from "buffer";
global.Buffer = Buffer;

// Import BleManager with error handling
let BleManager;
try {
  BleManager = require("react-native-ble-plx").BleManager;
} catch (error) {
  console.error("Failed to import BleManager:", error);
}

// BLE UUIDs
const SERVICE_UUID = "0000FFE0-0000-1000-8000-00805F9B34FB";
const CHARACTERISTIC_UUID = "0000FFE1-0000-1000-8000-00805F9B34FB";
const DEVICE_NAME = "BT05";

// Singleton BleManager instance
let bleManagerInstance = null;
const getBleManager = () => {
  if (bleManagerInstance == null && BleManager) {
    try {
      bleManagerInstance = new BleManager();
      console.log("BleManager initialized successfully");
    } catch (error) {
      console.error("Failed to initialize BleManager:", error);
    }
  }
  return bleManagerInstance;
};

export default function App() {
  const bleManagerRef = useRef(null);
  const scrollViewRef = useRef(null);
  const [device, setDevice] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [logs, setLogs] = useState(["Ready to connect..."]);
  const [bleAvailable, setBleAvailable] = useState(!!BleManager);
  const [servoState, setServoState] = useState(false);
  const scaleAnim = useRef(new Animated.Value(1)).current;

  // Add log message
  const addLog = (message) => {
    console.log(message);
    setLogs((prevLogs) => [...prevLogs, message]);
  };

  // Initialize BLE manager
  useEffect(() => {
    if (!BleManager) {
      addLog("BLE functionality is not available");
      Alert.alert(
        "BLE Not Supported",
        "Bluetooth Low Energy is not available."
      );
      return;
    }

    bleManagerRef.current = getBleManager();
    if (!bleManagerRef.current) {
      addLog("Failed to initialize BLE Manager");
      return;
    }
    addLog("BLE Manager initialized");

    // Check Bluetooth state
    bleManagerRef.current.state().then((state) => {
      addLog(`Bluetooth state: ${state}`);
      if (state !== 'PoweredOn') {
        addLog("Bluetooth is not powered on. Please enable Bluetooth.");
      }
    });

    requestPermissions();

    return () => {
      if (bleManagerRef.current) {
        bleManagerRef.current.stopDeviceScan();
      }
      if (device) {
        device.cancelConnection().catch((error) => {
          console.log(`Error during disconnect cleanup: ${error.message}`);
        });
      }
    };
  }, []); // Removed device dependency to avoid reinitializing on device changes

  // Request permissions
  const requestPermissions = async () => {
    if (Platform.OS === "android") {
      try {
        const permissions = [
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        ];
        if (Platform.Version >= 31) {
          permissions.push(
            PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
            PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT
          );
        }

        const granted = await PermissionsAndroid.requestMultiple(permissions);
        const allGranted = Object.values(granted).every(
          (status) => status === PermissionsAndroid.RESULTS.GRANTED
        );

        if (allGranted) {
          addLog("All required permissions granted");
          return true;
        } else {
          addLog("Some permissions denied");
          return false;
        }
      } catch (error) {
        addLog(`Permission error: ${error.message}`);
        return false;
      }
    } else if (Platform.OS === "ios") {
      // iOS requires NSBluetoothAlwaysUsageDescription in Info.plist
      addLog("iOS: Permission should be set in Info.plist");
      return true;
    }
    return true;
  };

  // Start scanning
  const startScan = async () => {
    if (!bleManagerRef.current) {
      addLog("BLE Manager not initialized");
      return;
    }
    if (isScanning) {
      addLog("Already scanning...");
      return;
    }

    try {
      const permissionsGranted = await requestPermissions();
      if (!permissionsGranted) {
        addLog("Required permissions not granted");
        return;
      }

      // Check if Bluetooth is turned on
      const state = await bleManagerRef.current.state();
      if (state !== 'PoweredOn') {
        addLog(`Bluetooth is not ready (state: ${state}). Please enable Bluetooth.`);
        Alert.alert(
          "Bluetooth not enabled",
          "Please enable Bluetooth on your device and try again.",
          [{ text: "OK" }]
        );
        return;
      }

      addLog("Scanning for BT05...");
      setIsScanning(true);

      const scanTimeoutId = setTimeout(() => {
        if (bleManagerRef.current) {
          bleManagerRef.current.stopDeviceScan();
          setIsScanning(false);
          addLog("Scan timed out. Device not found.");
        }
      }, 15000);

      bleManagerRef.current.startDeviceScan(
        null,
        { allowDuplicates: false },
        (error, scannedDevice) => {
          if (error) {
            clearTimeout(scanTimeoutId);
            setIsScanning(false);
            addLog(`Scan error: ${error.message}`);
            return;
          }

          // Log all found devices to help with debugging
          if (scannedDevice && scannedDevice.name) {
            console.log(`Found device: ${scannedDevice.name} (ID: ${scannedDevice.id})`);
          }

          if (scannedDevice) {
            // Check if device name is BT05 or if local name contains BT05
            const deviceName = scannedDevice.name;
            const localName = scannedDevice.localName;
            const hasMatchingName = (deviceName === DEVICE_NAME) || 
                                   (localName === DEVICE_NAME) || 
                                   (deviceName && deviceName.includes(DEVICE_NAME)) ||
                                   (localName && localName.includes(DEVICE_NAME));

            if (hasMatchingName) {
              clearTimeout(scanTimeoutId);
              bleManagerRef.current.stopDeviceScan();
              setIsScanning(false);
              addLog(`Found ${DEVICE_NAME}! (${deviceName || localName})`);
              connectToDevice(scannedDevice);
            }
          }
        }
      );
    } catch (error) {
      setIsScanning(false);
      addLog(`Scan error: ${error.message}`);
    }
  };

  // Connect to device
  const connectToDevice = async (scannedDevice) => {
    try {
      addLog(`Connecting to ${scannedDevice.name || scannedDevice.id}...`);
      
      // Attempt connection with retry logic
      let connectedDevice = null;
      let retryCount = 0;
      const maxRetries = 2;
      
      while (retryCount <= maxRetries && !connectedDevice) {
        try {
          if (retryCount > 0) {
            addLog(`Retry attempt ${retryCount}...`);
          }
          
          connectedDevice = await scannedDevice.connect({ 
            timeout: 10000,
            autoConnect: true
          });
          
          addLog("Connected!");
        } catch (connectionError) {
          retryCount++;
          if (retryCount > maxRetries) {
            throw connectionError;
          }
          addLog(`Connection attempt failed, retrying...`);
          // Short delay between retries
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      addLog("Discovering services and characteristics...");
      const discoveredDevice = await connectedDevice.discoverAllServicesAndCharacteristics();
      addLog("Services discovered");

      // Get available services for debugging
      const services = await discoveredDevice.services();
      addLog(`Found ${services.length} services`);
      
      // Verify service exists
      const targetService = services.find(s => s.uuid.toLowerCase() === SERVICE_UUID.toLowerCase());
      if (!targetService) {
        addLog(`WARNING: Target service ${SERVICE_UUID} not found!`);
        services.forEach(s => {
          addLog(`Available service: ${s.uuid}`);
        });
      } else {
        addLog(`Target service found: ${targetService.uuid}`);
        
        // Get characteristics
        const characteristics = await discoveredDevice.characteristicsForService(SERVICE_UUID);
        addLog(`Found ${characteristics.length} characteristics for service`);
        
        // Verify characteristic exists
        const targetCharacteristic = characteristics.find(
          c => c.uuid.toLowerCase() === CHARACTERISTIC_UUID.toLowerCase()
        );
        
        if (!targetCharacteristic) {
          addLog(`WARNING: Target characteristic ${CHARACTERISTIC_UUID} not found!`);
          characteristics.forEach(c => {
            addLog(`Available characteristic: ${c.uuid}`);
          });
        } else {
          addLog(`Target characteristic found: ${targetCharacteristic.uuid}`);
        }
      }

      setDevice(discoveredDevice);
      setIsConnected(true);

      // Monitor characteristic for rain detection
      discoveredDevice.monitorCharacteristicForService(
        SERVICE_UUID,
        CHARACTERISTIC_UUID,
        (error, characteristic) => {
          if (error) {
            addLog(`Monitor error: ${error.message}`);
            return;
          }

          if (characteristic?.value) {
            const message = Buffer.from(
              characteristic.value,
              "base64"
            ).toString("ascii");
            addLog(`Received: ${message}`);
            if (message.includes("RAIN")) {
              Alert.alert(
                "Rain Detected!",
                "Rainwater has been detected by the sensor."
              );
            }
          }
        }
      );

      // Setup disconnect listener
      discoveredDevice.onDisconnected((error, disconnectedDevice) => {
        const deviceName = disconnectedDevice?.name || 'Device';
        addLog(`Disconnected from ${deviceName}`);
        setIsConnected(false);
        setDevice(null);
        setServoState(false);
      });
    } catch (error) {
      addLog(`Connection error: ${error.message}`);
      setIsConnected(false);
      setDevice(null);
    }
  };

  // Disconnect from device
  const disconnectDevice = async () => {
    if (device) {
      try {
        addLog("Disconnecting...");
        await device.cancelConnection();
      } catch (error) {
        addLog(`Disconnect error: ${error.message}`);
        setIsConnected(false);
        setDevice(null);
        setServoState(false);
      }
    }
  };

  // Toggle servo
  const toggleServo = async () => {
    if (!device || !isConnected) {
      addLog("Not connected to device");
      return;
    }

    const newState = !servoState;
    const command = newState ? "ON\n" : "OFF\n";

    try {
      addLog(`Sending command: ${command.trim()}`);
      
      // First verify the service and characteristic are available
      const services = await device.services();
      const targetService = services.find(s => s.uuid.toLowerCase() === SERVICE_UUID.toLowerCase());
      
      if (!targetService) {
        addLog("ERROR: Service not available");
        return;
      }
      
      const characteristics = await device.characteristicsForService(SERVICE_UUID);
      const targetCharacteristic = characteristics.find(
        c => c.uuid.toLowerCase() === CHARACTERISTIC_UUID.toLowerCase()
      );
      
      if (!targetCharacteristic) {
        addLog("ERROR: Characteristic not available");
        return;
      }
      
      // Different write methods depending on characteristic properties
      const writeType = targetCharacteristic.isWritableWithResponse ? 'withResponse' : 'withoutResponse';
      addLog(`Using write ${writeType}`);
      
      if (writeType === 'withResponse') {
        await device.writeCharacteristicWithResponseForService(
          SERVICE_UUID,
          CHARACTERISTIC_UUID,
          Buffer.from(command).toString("base64")
        );
      } else {
        await device.writeCharacteristicWithoutResponseForService(
          SERVICE_UUID,
          CHARACTERISTIC_UUID,
          Buffer.from(command).toString("base64")
        );
      }
      
      setServoState(newState);
      addLog(`Command sent successfully: ${command.trim()}`);
    } catch (error) {
      addLog(`Command error: ${error.message}`);
      // Try to reconnect if we lost connection
      if (error.message.includes("disconnected") || error.message.includes("not connected")) {
        setIsConnected(false);
        setDevice(null);
        Alert.alert(
          "Connection Lost",
          "The connection to the device was lost. Would you like to reconnect?",
          [
            {
              text: "Yes",
              onPress: () => startScan()
            },
            {
              text: "No",
              style: "cancel"
            }
          ]
        );
      }
    }
  };

  // Button animation
  const handlePressIn = () => {
    Animated.spring(scaleAnim, {
      toValue: 0.95,
      useNativeDriver: true,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      useNativeDriver: true,
    }).start();
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Servo Control</Text>
      <View style={styles.statusContainer}>
        <Text style={styles.statusText}>
          {isConnected
            ? "Connected"
            : isScanning
            ? "Scanning..."
            : "Disconnected"}
        </Text>
      </View>

      <TouchableOpacity
        style={[styles.connectButton, isConnected && styles.disconnectButton]}
        onPress={isConnected ? disconnectDevice : startScan}
        disabled={isScanning}
      >
        <Text style={styles.buttonText}>
          {isConnected ? "Disconnect" : isScanning ? "Scanning..." : "Connect"}
        </Text>
      </TouchableOpacity>

      <View style={styles.controlContainer}>
        <Animated.View
          style={[styles.servoButton, { transform: [{ scale: scaleAnim }] }]}
        >
          <TouchableOpacity
            style={styles.innerButton}
            onPress={toggleServo}
            onPressIn={handlePressIn}
            onPressOut={handlePressOut}
            disabled={!isConnected}
          >
            <Text style={styles.servoText}>
              {servoState ? "ON (270°)" : "OFF (0°)"}
            </Text>
          </TouchableOpacity>
        </Animated.View>
      </View>

      <View style={styles.logContainer}>
        <Text style={styles.logTitle}>Logs</Text>
        <ScrollView
          ref={scrollViewRef}
          onContentSizeChange={() => {
            scrollViewRef.current?.scrollToEnd({ animated: true });
          }}
        >
          {logs.map((log, index) => (
            <Text key={index} style={styles.logText}>
              {log}
            </Text>
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#1A1A1A",
    padding: 20,
    paddingTop: 50,
  },
  title: {
    fontSize: 28,
    fontWeight: "600",
    color: "#FFFFFF",
    textAlign: "center",
    marginBottom: 20,
  },
  statusContainer: {
    backgroundColor: "rgba(255, 255, 255, 0.1)",
    borderRadius: 12,
    padding: 12,
    marginBottom: 20,
    backdropFilter: "blur(10px)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.2)",
  },
  statusText: {
    fontSize: 16,
    color: "#00DDEB",
    textAlign: "center",
    fontWeight: "500",
  },
  connectButton: {
    backgroundColor: "rgba(0, 221, 235, 0.2)",
    padding: 15,
    borderRadius: 12,
    alignItems: "center",
    marginBottom: 30,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.2)",
  },
  disconnectButton: {
    backgroundColor: "rgba(255, 107, 107, 0.2)",
  },
  buttonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  controlContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  servoButton: {
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: "rgba(255, 255, 255, 0.1)",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.2)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  innerButton: {
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: "rgba(0, 221, 235, 0.3)",
    justifyContent: "center",
    alignItems: "center",
  },
  servoText: {
    fontSize: 18,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  logContainer: {
    flex: 1,
    backgroundColor: "rgba(255, 255, 255, 0.1)",
    borderRadius: 12,
    padding: 15,
    marginTop: 20,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.2)",
  },
  logTitle: {
    fontSize: 18,
    color: "#FFFFFF",
    marginBottom: 10,
    fontWeight: "500",
  },
  logText: {
    color: "rgba(255, 255, 255, 0.7)",
    fontSize: 14,
    marginBottom: 5,
  },
});
