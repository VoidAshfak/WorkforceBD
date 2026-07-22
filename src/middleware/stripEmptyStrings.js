/**
 * Drops top-level body fields that arrived as empty strings.
 *
 * A wizard form posts every input it renders, so untouched fields arrive as `""`
 * rather than absent. Treating them as "not filled in" is what lets a draft be
 * saved half-finished, and keeps `pay_amount: ""` from reaching a numeric column.
 * Only applied on create routes — on PATCH an explicit `""` still means "clear".
 *
 * @type {import("express").RequestHandler}
 */
const stripEmptyStrings = (req, _res, next) => {
  const body = req.body;
  if (body && typeof body === "object" && !Array.isArray(body)) {
    for (const [key, value] of Object.entries(body)) {
      if (typeof value === "string" && value.trim() === "") delete body[key];
    }
  }
  next();
};

export default stripEmptyStrings;
