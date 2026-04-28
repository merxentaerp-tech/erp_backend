import jwt from "jsonwebtoken";

// ================= BASIC AUTH (OLD) =================
export const auth = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "No token provided",
      });
    }

    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    req.user = decoded;

    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired token",
      error: error.message,
    });
  }
};

// ================= ADVANCED AUTH (NEW) =================
export const authMiddleware = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Authorization token missing",
      });
    }

    const token = authHeader.split(" ")[1];

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    req.user = {
      id: decoded.id,
      email: decoded.email,
      role: decoded.role,
      store_code: decoded.store_code,
      organization_id: decoded.organization_id,
      organization_level: decoded.organization_level,
    };

    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired token",
    });
  }
};

// ================= ROLE CHECK (SIMPLE) =================
export const checkRole = (role) => {
  return (req, res, next) => {
    const userRole = req.headers.role;

    if (!userRole) {
      return res.status(401).json({
        message: "Role not provided in headers",
      });
    }

    if (userRole !== role) {
      return res.status(403).json({
        message: `Access denied. Only ${role} allowed`,
      });
    }

    next();
  };
};

// ================= MULTIPLE ROLE CHECK =================
export const checkRoles = (roles = []) => {
  return (req, res, next) => {
    const userRole = req.headers.role;

    if (!userRole) {
      return res.status(401).json({
        message: "Role not provided in headers",
      });
    }

    if (!roles.includes(userRole)) {
      return res.status(403).json({
        message: `Access denied. Allowed roles: ${roles.join(", ")}`,
      });
    }

    next();
  };
};

// ================= ROLE BASED ACCESS (JWT BASED) =================
export const authorizeRoles = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: "Access denied: insufficient permissions",
      });
    }
    next();
  };
};

// ================= ORGANIZATION LEVEL =================
export const authorizeLevel = (...levels) => {
  return (req, res, next) => {
    if (!req.user || !levels.includes(req.user.organization_level)) {
      return res.status(403).json({
        success: false,
        message: "Access denied: invalid organization level",
      });
    }
    next();
  };
};

// ================= STORE RESTRICTION =================
export const restrictToOwnStore = (req, res, next) => {
  if (!req.user || !req.user.store_code) {
    return res.status(400).json({
      success: false,
      message: "Store not assigned to user",
    });
  }

  req.storeCode = req.user.store_code;

  next();
};

// ================= SUPER ADMIN =================
export const allowSuperAdminAll = (req, res, next) => {
  if (req.user && req.user.role === "SUPER_ADMIN") {
    req.isSuperAdmin = true;
  }
  next();
};
