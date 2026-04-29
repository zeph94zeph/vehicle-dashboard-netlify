// Notion API proxy for vehicle dashboard
// Env: NOTION_TOKEN (set in Netlify environment variables)

const NOTION_VERSION = "2022-06-28";
const VEHICLES_DB = "ed6064d3acb246758dd002aa667d6b70";
const MAINT_DB = "89005b6f781242e5853cfc5e7448a68a";

const headers = (token) => ({
  "Authorization": `Bearer ${token}`,
  "Notion-Version": NOTION_VERSION,
  "Content-Type": "application/json",
});

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const reply = (status, body) => ({
  statusCode: status,
  headers: { ...cors, "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const txt = (p) => p?.rich_text?.[0]?.plain_text || p?.title?.[0]?.plain_text || "";
const num = (p) => p?.number ?? null;
const sel = (p) => p?.select?.name || "";
const dat = (p) => p?.date?.start || "";
const url = (p) => p?.url || "";
const files = (p) => (p?.files || []).map(f => f.external?.url || f.file?.url || "").filter(Boolean);

async function notionQuery(token, dbId, body = {}) {
  const r = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Notion query ${dbId} failed: ${r.status} ${await r.text()}`);
  const data = await r.json();
  return data.results || [];
}

async function notionCreatePage(token, dbId, properties) {
  const r = await fetch(`https://api.notion.com/v1/pages`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({
      parent: { database_id: dbId },
      properties,
    }),
  });
  if (!r.ok) throw new Error(`Notion create failed: ${r.status} ${await r.text()}`);
  return r.json();
}

async function notionUpdatePage(token, pageId, properties) {
  const r = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: "PATCH",
    headers: headers(token),
    body: JSON.stringify({ properties }),
  });
  if (!r.ok) throw new Error(`Notion update failed: ${r.status} ${await r.text()}`);
  return r.json();
}

async function notionGetPage(token, pageId) {
  const r = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    headers: headers(token),
  });
  if (!r.ok) throw new Error(`Notion get page failed: ${r.status} ${await r.text()}`);
  return r.json();
}

// 2-step Notion file upload (single_part, ≤5MB free / 20MB paid)
async function notionUploadFile(token, filename, contentType, bytes) {
  // Step 1: create upload
  const r1 = await fetch("https://api.notion.com/v1/file_uploads", {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({ mode: "single_part", filename, content_type: contentType }),
  });
  if (!r1.ok) throw new Error(`File upload create failed: ${r1.status} ${await r1.text()}`);
  const upload = await r1.json();

  // Step 2: send file bytes via multipart/form-data
  const fd = new FormData();
  const blob = new Blob([bytes], { type: contentType });
  fd.append("file", blob, filename);

  const r2 = await fetch(upload.upload_url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_VERSION,
    },
    body: fd,
  });
  if (!r2.ok) throw new Error(`File upload send failed: ${r2.status} ${await r2.text()}`);
  return r2.json();
}

function mapVehicle(p) {
  const props = p.properties || {};
  return {
    id: num(props["アプリID"]) || 0,
    notionId: p.id,
    name: txt(props["車両名"]),
    category: sel(props["車種"]),
    model: txt(props["型式"]),
    reg: txt(props["登録番号"]),
    owner: txt(props["所有者"]),
    inspectionDue: dat(props["車検期限"]),
    fuel: sel(props["燃料"]),
    status: sel(props["状態"]),
    notes: txt(props["備考"]),
    attachments: files(props["添付ファイル"]),
    notionUrl: p.url,
  };
}

function mapMaint(p) {
  const props = p.properties || {};
  return {
    notionId: p.id,
    title: txt(props["項目"]),
    vehicleName: sel(props["車両名"]),
    vehicleId: num(props["車両ID"]) || 0,
    date: dat(props["実施日"]),
    type: sel(props["作業種別"]),
    worker: txt(props["作業者"]),
    labor: num(props["工賃"]),
    parts: num(props["部品代"]),
    mileage: num(props["走行距離"]),
    nextRecommendation: txt(props["次回交換推奨"]),
    partUrl: url(props["部品URL"]),
    content: txt(props["作業内容"]),
    notes: txt(props["備考"]),
    status: sel(props["状態"]),
    attachments: files(props["添付ファイル"]),
    notionUrl: p.url,
  };
}

function buildMaintProps(d) {
  const p = {};
  if (d.title) p["項目"] = { title: [{ text: { content: d.title } }] };
  if (d.vehicleName) p["車両名"] = { select: { name: d.vehicleName } };
  if (d.vehicleId != null) p["車両ID"] = { number: parseInt(d.vehicleId) };
  if (d.date) p["実施日"] = { date: { start: d.date } };
  if (d.type) p["作業種別"] = { select: { name: d.type } };
  if (d.worker) p["作業者"] = { rich_text: [{ text: { content: d.worker } }] };
  if (d.labor != null) p["工賃"] = { number: parseInt(d.labor) || 0 };
  if (d.parts != null) p["部品代"] = { number: parseInt(d.parts) || 0 };
  if (d.mileage != null) p["走行距離"] = { number: parseInt(d.mileage) || 0 };
  if (d.content) p["作業内容"] = { rich_text: [{ text: { content: d.content } }] };
  if (d.notes) p["備考"] = { rich_text: [{ text: { content: d.notes } }] };
  if (d.nextRecommendation) p["次回交換推奨"] = { rich_text: [{ text: { content: d.nextRecommendation } }] };
  if (d.status) p["状態"] = { select: { name: d.status } };
  return p;
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };

  const token = process.env.NOTION_TOKEN;
  if (!token) return reply(500, { error: "NOTION_TOKEN env var not set" });

  try {
    if (event.httpMethod === "GET") {
      const action = (event.queryStringParameters || {}).action;

      if (action === "vehicles") {
        const rows = await notionQuery(token, VEHICLES_DB, {
          sorts: [{ property: "アプリID", direction: "ascending" }],
          page_size: 100,
        });
        return reply(200, { vehicles: rows.map(mapVehicle) });
      }

      if (action === "maintenance") {
        const rows = await notionQuery(token, MAINT_DB, {
          sorts: [{ property: "実施日", direction: "descending" }],
          page_size: 100,
        });
        return reply(200, { maintenance: rows.map(mapMaint) });
      }

      if (action === "all") {
        const [v, m] = await Promise.all([
          notionQuery(token, VEHICLES_DB, { sorts: [{ property: "アプリID", direction: "ascending" }], page_size: 100 }),
          notionQuery(token, MAINT_DB, { sorts: [{ property: "実施日", direction: "descending" }], page_size: 100 }),
        ]);
        return reply(200, { vehicles: v.map(mapVehicle), maintenance: m.map(mapMaint) });
      }

      return reply(400, { error: "unknown action; use ?action=vehicles|maintenance|all" });
    }

    if (event.httpMethod === "POST") {
      const data = JSON.parse(event.body || "{}");
      const action = data.action;

      if (action === "create-maintenance") {
        const props = buildMaintProps(data);
        if (!props["項目"] || !props["車両名"]) {
          return reply(400, { error: "title (項目) and vehicleName (車両名) required" });
        }
        const result = await notionCreatePage(token, MAINT_DB, props);
        return reply(200, { ok: true, page: mapMaint(result) });
      }

      if (action === "update-maintenance") {
        if (!data.notionId) return reply(400, { error: "notionId required" });
        const props = buildMaintProps(data);
        const result = await notionUpdatePage(token, data.notionId, props);
        return reply(200, { ok: true, page: mapMaint(result) });
      }

      if (action === "upload-photo" || action === "upload-photos") {
        // Body: { notionId, photos: [{ filename, contentType, base64 }, ...] }
        // Backwards-compat: { notionId, filename, contentType, base64 } for single photo
        if (!data.notionId) return reply(400, { error: "notionId required" });
        const photos = data.photos || (data.base64 ? [{ filename: data.filename, contentType: data.contentType, base64: data.base64 }] : []);
        if (!photos.length) return reply(400, { error: "no photos provided" });

        // Validate sizes upfront
        for (const p of photos) {
          const bytes = Buffer.from(p.base64, "base64");
          if (bytes.length > 5 * 1024 * 1024) return reply(413, { error: `${p.filename || "photo"}: 5MB超過` });
          p._bytes = bytes;
        }

        // Upload all photos to Notion sequentially (creates file_upload IDs)
        const uploadIds = [];
        for (const p of photos) {
          const filename = p.filename || `photo_${Date.now()}.jpg`;
          const contentType = p.contentType || "image/jpeg";
          const upload = await notionUploadFile(token, filename, contentType, p._bytes);
          uploadIds.push({ id: upload.id, name: filename });
        }

        // Get current page to merge attachments
        const page = await notionGetPage(token, data.notionId);
        const currentFiles = page.properties?.["添付ファイル"]?.files || [];

        // Build full files array. Only preserve "external" type (Drive URLs etc).
        // Notion-hosted "file" type entries can't be re-PATCHed via API (Notion limitation).
        // → They're dropped on PATCH. Document this clearly to user.
        const preserved = currentFiles
          .filter(f => f.type === "external")
          .map(f => ({ type: "external", external: { url: f.external.url }, name: f.name }));
        const droppedCount = currentFiles.length - preserved.length;

        const newFiles = [
          ...preserved,
          ...uploadIds.map(u => ({ type: "file_upload", file_upload: { id: u.id }, name: u.name })),
        ];

        // Single PATCH with all files
        const patched = await notionUpdatePage(token, data.notionId, {
          "添付ファイル": { files: newFiles },
        });
        return reply(200, {
          ok: true,
          uploaded: uploadIds.length,
          dropped: droppedCount,
          page: mapMaint(patched),
        });
      }

      return reply(400, { error: "unknown action" });
    }

    return reply(405, { error: "method not allowed" });
  } catch (e) {
    return reply(500, { error: e.message });
  }
};
