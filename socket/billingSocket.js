// socket/billingSocket.js

export const registerBillingSocket = (socket) => {
  /**
   * BILLING SESSION ROOM
   */
  socket.on("join-billing-session", (roomName) => {
    try {
      if (!roomName) return;

      const cleanRoom = String(roomName).trim();

      if (!cleanRoom.startsWith("billing_session_")) {
        console.log("Invalid billing session room:", cleanRoom);
        return;
      }

      socket.join(cleanRoom);

      console.log(
        `Socket ${socket.id} joined ${cleanRoom}`
      );

      socket.emit("billing-session-joined", {
        success: true,
        room: cleanRoom,
        socket_id: socket.id,
      });

    } catch (error) {
      console.error(
        "join-billing-session error:",
        error.message
      );
    }
  });

  /**
   * BILLING STORE ROOM
   */
  socket.on("join-billing-store", (storeCode) => {
    try {
      if (!storeCode) return;

      const cleanStoreCode = String(storeCode)
        .trim()
        .toUpperCase();

      const roomName = `billing_store_${cleanStoreCode}`;

      socket.join(roomName);

      console.log(
        `Socket ${socket.id} joined ${roomName}`
      );

      socket.emit("billing-store-joined", {
        success: true,
        room: roomName,
      });

    } catch (error) {
      console.error(
        "join-billing-store error:",
        error.message
      );
    }
  });

  /**
   * BILLING ORGANIZATION ROOM
   */
  socket.on("join-billing-org", (organizationId) => {
    try {
      if (!organizationId) return;

      const roomName = `billing_org_${organizationId}`;

      socket.join(roomName);

      console.log(
        `Socket ${socket.id} joined ${roomName}`
      );

      socket.emit("billing-org-joined", {
        success: true,
        room: roomName,
      });

    } catch (error) {
      console.error(
        "join-billing-org error:",
        error.message
      );
    }
  });
};

/**
 * GLOBAL EMIT HELPER
 */
export const emitBillingScan = ({
  organization_id,
  store_code,
  item,
}) => {
  try {
    if (!global.io) return;

    /**
     * STORE ROOM EMIT
     */
    if (store_code) {
      global.io
        .to(`billing_store_${store_code}`)
        .emit("billing-item-scanned", {
          success: true,
          store_code,
          item,
        });
    }

    /**
     * ORG ROOM EMIT
     */
    if (organization_id) {
      global.io
        .to(`billing_org_${organization_id}`)
        .emit("billing-item-scanned", {
          success: true,
          organization_id,
          item,
        });
    }

  } catch (error) {
    console.error(
      "emitBillingScan error:",
      error.message
    );
  }
};
