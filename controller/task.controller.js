export const getPendingTasks = async (req, res) => {
  try {
    const user = req.user;

    const where = {
      status: "pending",
    };

    if (user.role !== "super_admin") {
      where[Op.or] = [
        { assigned_to: user.id },
        { district_code: user.district_code || null },
        { store_code: user.store_code || null },
      ];
    }

    const tasks = await Task.findAll({
      where,
      order: [["created_at", "DESC"]],
      limit: 20,
    });

    return res.status(200).json({
      success: true,
      data: tasks,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch pending tasks",
      error: error.message,
    });
  }
};