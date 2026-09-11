/**
 * Socket.IO Service
 *
 * Real-time communication service for:
 * - Clock in/out notifications
 * - Shift updates
 * - Roster changes
 * - Live attendance tracking
 */

const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const config = require('../config');
const logger = require('../utils/logger');
const Employee = require('../models/Employee');

class SocketService {
  constructor() {
    this.io = null;
    this.connectedUsers = new Map(); // userId -> socketId mapping
  }

  /**
   * Initialize Socket.IO server
   * @param {Object} httpServer - HTTP server instance
   */
  initialize(httpServer) {
    this.io = new Server(httpServer, {
      cors: {
        origin: config.client.url,
        methods: ['GET', 'POST'],
        credentials: true,
      },
      pingTimeout: 60000,
      pingInterval: 25000,
    });

    // Authentication middleware
    this.io.use(async (socket, next) => {
      try {
        const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.replace('Bearer ', '');

        if (!token) {
          return next(new Error('Authentication token required'));
        }

        // Verify JWT token
        const decoded = jwt.verify(token, config.auth.jwtSecret);
        socket.userId = decoded.userId;
        socket.userRole = decoded.role;
        socket.companyId = decoded.companyId;

        logger.info('Socket authenticated', {
          userId: socket.userId,
          role: socket.userRole,
          socketId: socket.id,
        });

        next();
      } catch (error) {
        logger.error('Socket authentication failed', { error: error.message });
        next(new Error('Authentication failed'));
      }
    });

    // Connection handling
    this.io.on('connection', (socket) => {
      this.handleConnection(socket);
    });

    logger.info('✓ Socket.IO server initialized');
  }

  /**
   * Handle new socket connection
   * @param {Object} socket - Socket instance
   */
  async handleConnection(socket) {
    const { userId, userRole, companyId } = socket;

    // Store user connection
    this.connectedUsers.set(userId, socket.id);

    // Join user-specific room
    socket.join(`user:${userId}`);

    // A master admin belongs to no organisation, so it joins no company rooms
    if (userRole !== 'MASTER' && companyId) {
      socket.join(`company:${companyId}`);

      // Roles on the token are upper case
      if (userRole === 'ADMIN' || userRole === 'MANAGER') {
        socket.join(`managers:${companyId}`);
      }

      // Shift notifications are addressed by employee id, which is not the same
      // as the user id, so employees join a room keyed by their employee record
      try {
        const employee = await Employee.findOne({ userId, companyId })
          .select('_id')
          .lean();

        if (employee) {
          socket.employeeId = String(employee._id);
          socket.join(`employee:${socket.employeeId}`);
        }
      } catch (error) {
        logger.error('Could not resolve the employee record for a socket', {
          userId,
          error: error.message,
        });
      }
    }

    logger.info('User connected to socket', {
      userId,
      userRole,
      companyId,
      socketId: socket.id,
      totalConnections: this.connectedUsers.size,
    });

    // Send welcome message
    socket.emit('connected', {
      message: 'Connected to real-time server',
      userId,
      timestamp: new Date(),
    });

    // Handle disconnection
    socket.on('disconnect', () => {
      this.connectedUsers.delete(userId);
      logger.info('User disconnected from socket', {
        userId,
        socketId: socket.id,
        totalConnections: this.connectedUsers.size,
      });
    });

    // Custom event handlers
    this.setupEventHandlers(socket);
  }

  /**
   * Set up custom event handlers
   * @param {Object} socket - Socket instance
   */
  setupEventHandlers(socket) {
    // Example: Handle custom events
    socket.on('ping', () => {
      socket.emit('pong', { timestamp: new Date() });
    });
  }

  // ==========================================
  // CLOCK IN/OUT EVENTS
  // ==========================================

  /**
   * Notify managers when employee clocks in
   * @param {Object} data - Clock in data
   */
  notifyClockIn(data) {
    if (!this.io) return;
    const { companyId, employee, site, timestamp, location } = data;

    const notification = {
      type: 'CLOCK_IN',
      title: 'Employee Clocked In',
      message: `${employee.name} clocked in at ${site.name}`,
      data: {
        employeeId: employee.id,
        employeeName: employee.name,
        siteId: site.id,
        siteName: site.name,
        timestamp,
        location,
      },
      timestamp: new Date(),
    };

    // Notify all managers in the company
    this.io.to(`managers:${companyId}`).emit('clock-in', notification);

    logger.info('Clock-in notification sent', {
      employeeId: employee.id,
      siteId: site.id,
      companyId,
    });
  }

  /**
   * Notify managers when employee clocks out
   * @param {Object} data - Clock out data
   */
  notifyClockOut(data) {
    if (!this.io) return;
    const { companyId, employee, site, timestamp, duration, location } = data;

    const notification = {
      type: 'CLOCK_OUT',
      title: 'Employee Clocked Out',
      message: `${employee.name} clocked out from ${site.name}`,
      data: {
        employeeId: employee.id,
        employeeName: employee.name,
        siteId: site.id,
        siteName: site.name,
        timestamp,
        duration,
        location,
      },
      timestamp: new Date(),
    };

    // Notify all managers in the company
    this.io.to(`managers:${companyId}`).emit('clock-out', notification);

    logger.info('Clock-out notification sent', {
      employeeId: employee.id,
      siteId: site.id,
      companyId,
    });
  }

  // ==========================================
  // SHIFT EVENTS
  // ==========================================

  /**
   * Notify when a shift is created
   * @param {Object} shift - Shift data
   */
  notifyShiftCreated(shift) {
    const { companyId, assignedTo, site } = shift;

    const notification = {
      type: 'SHIFT_CREATED',
      title: 'New Shift Assigned',
      message: `You have been assigned a new shift at ${site?.name || 'a site'}`,
      data: shift,
      timestamp: new Date(),
    };

    // Notify assigned employees
    if (Array.isArray(assignedTo)) {
      assignedTo.forEach((employeeId) => {
        this.io.to(`employee:${employeeId}`).emit('shift-created', notification);
      });
    }

    // Notify all managers
    this.io.to(`managers:${companyId}`).emit('shift-created', notification);

    logger.info('Shift created notification sent', {
      shiftId: shift.id,
      assignedTo,
      companyId,
    });
  }

  /**
   * Notify when a shift is updated
   * @param {Object} shift - Updated shift data
   */
  notifyShiftUpdated(shift) {
    const { companyId, assignedTo, site } = shift;

    const notification = {
      type: 'SHIFT_UPDATED',
      title: 'Shift Updated',
      message: `Your shift at ${site?.name || 'a site'} has been updated`,
      data: shift,
      timestamp: new Date(),
    };

    // Notify assigned employees
    if (Array.isArray(assignedTo)) {
      assignedTo.forEach((employeeId) => {
        this.io.to(`employee:${employeeId}`).emit('shift-updated', notification);
      });
    }

    // Notify all managers
    this.io.to(`managers:${companyId}`).emit('shift-updated', notification);

    logger.info('Shift updated notification sent', {
      shiftId: shift.id,
      assignedTo,
      companyId,
    });
  }

  /**
   * Notify when a shift is deleted
   * @param {Object} data - Shift deletion data
   */
  notifyShiftDeleted(data) {
    const { companyId, shiftId, assignedTo, siteName } = data;

    const notification = {
      type: 'SHIFT_DELETED',
      title: 'Shift Cancelled',
      message: `Your shift at ${siteName || 'a site'} has been cancelled`,
      data: { shiftId },
      timestamp: new Date(),
    };

    // Notify assigned employees
    if (Array.isArray(assignedTo)) {
      assignedTo.forEach((employeeId) => {
        this.io.to(`employee:${employeeId}`).emit('shift-deleted', notification);
      });
    }

    // Notify all managers
    this.io.to(`managers:${companyId}`).emit('shift-deleted', notification);

    logger.info('Shift deleted notification sent', {
      shiftId,
      assignedTo,
      companyId,
    });
  }

  // ==========================================
  // ROSTER EVENTS
  // ==========================================

  /**
   * Notify when roster is updated
   * @param {Object} data - Roster update data
   */
  notifyRosterUpdated(data) {
    const { companyId, date, changes } = data;

    const notification = {
      type: 'ROSTER_UPDATED',
      title: 'Roster Updated',
      message: `The roster for ${date} has been updated`,
      data: { date, changes },
      timestamp: new Date(),
    };

    // Notify entire company
    this.io.to(`company:${companyId}`).emit('roster-updated', notification);

    logger.info('Roster updated notification sent', {
      companyId,
      date,
    });
  }

  // ==========================================
  // GENERAL NOTIFICATIONS
  // ==========================================

  /**
   * Send notification to specific user
   * @param {String} userId - User ID
   * @param {Object} notification - Notification data
   */
  notifyUser(userId, notification) {
    this.io.to(`user:${userId}`).emit('notification', {
      ...notification,
      timestamp: new Date(),
    });

    logger.info('User notification sent', { userId, type: notification.type });
  }

  /**
   * Send notification to all managers
   * @param {String} companyId - Company ID
   * @param {Object} notification - Notification data
   */
  notifyManagers(companyId, notification) {
    this.io.to(`managers:${companyId}`).emit('notification', {
      ...notification,
      timestamp: new Date(),
    });

    logger.info('Manager notification sent', { companyId, type: notification.type });
  }

  /**
   * Broadcast to entire company
   * @param {String} companyId - Company ID
   * @param {Object} notification - Notification data
   */
  broadcastToCompany(companyId, notification) {
    this.io.to(`company:${companyId}`).emit('notification', {
      ...notification,
      timestamp: new Date(),
    });

    logger.info('Company broadcast sent', { companyId, type: notification.type });
  }

  // ==========================================
  // ADHOC SHIFT REQUEST EVENTS
  // ==========================================

  /**
   * An employee has asked for an adhoc shift — tell whoever can approve it.
   */
  notifyAdhocRequested({ companyId, employeeName, siteName, shiftId }) {
    if (!this.io) return;

    this.io.to(`managers:${companyId}`).emit('notification', {
      type: 'ADHOC_REQUESTED',
      title: 'Adhoc shift requested',
      message: `${employeeName} has requested an adhoc shift at ${siteName}`,
      data: { shiftId },
      timestamp: new Date(),
    });

    logger.info('Adhoc request notification sent', { companyId, shiftId });
  }

  /**
   * A request has been approved or rejected — tell the employee, and the
   * managers so a second reviewer sees it is already handled.
   */
  notifyAdhocReviewed({ companyId, employeeId, approved, note, shift }) {
    if (!this.io) return;

    const notification = {
      type: approved ? 'ADHOC_APPROVED' : 'ADHOC_REJECTED',
      title: approved ? 'Adhoc shift approved' : 'Adhoc shift declined',
      message: approved
        ? 'Your adhoc shift request has been approved'
        : 'Your adhoc shift request has been declined',
      data: { shiftId: shift?._id ? String(shift._id) : undefined, note },
      timestamp: new Date(),
    };

    if (employeeId) {
      this.io.to(`employee:${employeeId}`).emit('notification', notification);
    }

    this.io.to(`managers:${companyId}`).emit('notification', notification);

    logger.info('Adhoc decision notification sent', {
      companyId,
      employeeId,
      approved,
    });
  }

  notifyBreakStarted({ companyId, employeeName, siteName }) {
    if (!this.io) return;
    this.io.to(`managers:${companyId}`).emit('break-start', {
      type: 'BREAK_STARTED',
      title: 'Employee on break',
      message: `${employeeName} started a break at ${siteName}`,
      timestamp: new Date(),
    });
  }

  notifyBreakEnded({ companyId, employeeName, siteName }) {
    if (!this.io) return;
    this.io.to(`managers:${companyId}`).emit('break-end', {
      type: 'BREAK_ENDED',
      title: 'Break ended',
      message: `${employeeName} resumed work at ${siteName}`,
      timestamp: new Date(),
    });
  }

  // ==========================================
  // UTILITY METHODS
  // ==========================================

  /**
   * Check if user is connected
   * @param {String} userId - User ID
   * @returns {Boolean}
   */
  isUserConnected(userId) {
    return this.connectedUsers.has(userId);
  }

  /**
   * Get total connected users
   * @returns {Number}
   */
  getConnectedCount() {
    return this.connectedUsers.size;
  }

  /**
   * Get Socket.IO instance
   * @returns {Object} Socket.IO instance
   */
  getIO() {
    return this.io;
  }
}

// Export singleton instance
module.exports = new SocketService();
