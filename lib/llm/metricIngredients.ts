/**
 * Converts imperial weight units on ingredients to metric (g/kg) when the model
 * still returns oz/lb despite prompts.
 */
export type IngredientLike = {
  name: string;
  quantity: number | null;
  unit: string | null;
};

const OZ_TO_G = 28.349523125;
const LB_TO_G = 453.59237;

function roundGrams(g: number): number {
  if (g < 500) return Math.round(g);
  return Math.round(g * 10) / 10;
}

export function metricizeIngredientWeight<T extends IngredientLike>(ing: T): T {
  const q = ing.quantity;
  const raw = ing.unit?.trim().toLowerCase() ?? "";
  if (q == null || !raw) return ing;

  if (raw === "oz" || raw === "ounce" || raw === "ounces") {
    const g = q * OZ_TO_G;
    return { ...ing, quantity: roundGrams(g), unit: "g" };
  }

  if (
    raw === "lb" ||
    raw === "lbs" ||
    raw === "pound" ||
    raw === "pounds"
  ) {
    const g = q * LB_TO_G;
    if (g >= 1000) {
      return {
        ...ing,
        quantity: Math.round((g / 1000) * 100) / 100,
        unit: "kg",
      };
    }
    return { ...ing, quantity: roundGrams(g), unit: "g" };
  }

  return ing;
}

export function metricizeAllIngredients<T extends IngredientLike>(
  ingredients: T[],
): T[] {
  return ingredients.map((i) => metricizeIngredientWeight(i));
}
