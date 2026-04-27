import { getGoldRate } from "../service/goldService";

export const fetchGoldRate = async (req, res) => {
  try {
    const data = await getGoldRate();

    res.status(200).json({
      success: true,
      message: "Gold rate fetched successfully",
      data: {
        price_gram_24k: data.price_gram_24k,
        price_gram_22k: data.price_gram_22k,
        price_gram_18k: data.price_gram_18k,
        currency: data.currency,
        timestamp: data.timestamp,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch gold rate",
    });
  }
};