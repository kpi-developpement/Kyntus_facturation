// frontend/components/dossiers/dossiers-list.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { RefreshCw, Upload, Download, X, ChevronRight, Info, Layers, Sparkles, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";

import {
  exportDossiersXlsx,
  listDossiers,
  statutsFinal,
} from "@/services/dossiersApi";

import type {
  DossierFacturable,
  DossiersFilters,
} from "@/services/dossiersApi";

import FiltersBar from "./filters-bar";
import FileUploadModal from "./file-upload-modal";
import OrangeComparisonSection from "./orange-comparison-section";

// --- NOUVEAU: Import pour vérifier si l'utilisateur est admin ---
import { isAdmin } from "@/lib/auth";
// ----------------------------------------------------------------

// --- NOUVEAU: Fonction getMotifLabel ---
const getMotifLabel = (motif?: string | null) => {
  if (!motif) return null;

  switch (motif) {
    case "PREVISITE":
      return "Prévisite";
    case "GARANTIE_30J":
      return "Garantie 30j";
    case "CROISEMENT_INCOMPLET":
      return "Croisement incomplet";
    case "ACTPROD_MANQUANT":
      return "Act/Prod manquant";
    case "REGLE_MANQUANTE":
      return "Règle manquante";
    case "CLOTURE_INVALIDE":
      return "Clôture invalide";
    case "NON_FACTURABLE_REGLE":
      return "Non facturable";
    default:
      return motif;
  }
};
// ------------------------------------

const PAGE_SIZE = 300;

type BadgeKind =
  | "green" | "yellow" | "red" | "gray" | "purple" | "blue" | "orange"
  | "indigo" | "teal" | "rose" | "slate" | "cyan" | "fuchsia" | "lime" | "lightBlue";

const DETAILS_BTN_CLASS =
  "inline-flex items-center justify-center rounded-md px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap shadow-sm transition-colors";

function badgeClass(kind: BadgeKind) {
  switch (kind) {
    case "green": return "bg-green-100 text-green-800";
    case "yellow": return "bg-amber-100 text-amber-900";
    case "red": return "bg-red-100 text-red-800";
    case "purple": return "bg-violet-100 text-violet-800";
    case "blue": return "bg-sky-100 text-sky-800";
    case "orange": return "bg-orange-100 text-orange-900";
    case "indigo": return "bg-indigo-100 text-indigo-800";
    case "teal": return "bg-teal-100 text-teal-900";
    case "rose": return "bg-rose-100 text-rose-800";
    case "slate": return "bg-slate-100 text-slate-800";
    case "cyan": return "bg-cyan-100 text-cyan-900";
    case "fuchsia": return "bg-fuchsia-100 text-fuchsia-900";
    case "lime": return "bg-lime-100 text-lime-900";
    case "lightBlue": return "bg-blue-50 text-blue-800 border border-blue-200";
    default: return "bg-gray-100 text-gray-800";
  }
}

function Badge({ txt, kind = "gray" }: { txt: string; kind?: BadgeKind }) {
  return (
    <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${badgeClass(kind)}`}>
      {txt}
    </span>
  );
}

function Chip({ txt }: { txt: string }) {
  return (
    <span className="inline-flex items-center rounded-full border bg-white px-2 py-1 text-xs font-medium text-gray-700">
      {txt}
    </span>
  );
}

// Nouveau composant pour le statut final avec motif
function StatusFinalCell({ dossier }: { dossier: DossierFacturable }) {
  const sf = dossier.statut_final ?? "NON_FACTURABLE";
  const motif = getMotifLabel(dossier.motif_verification);

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          padding: "4px 8px",
          borderRadius: "8px",
          fontSize: "12px",
          fontWeight: 600,
          background:
            sf === "FACTURABLE"
              ? "#dcfce7"
              : sf === "NON_FACTURABLE"
              ? "#fee2e2"
              : "#fef3c7",
          color:
            sf === "FACTURABLE"
              ? "#166534"
              : sf === "NON_FACTURABLE"
              ? "#991b1b"
              : "#92400e",
        }}
      >
        {sf === "NON_FACTURABLE"
          ? "NON FACTURABLE"
          : sf === "FACTURABLE"
          ? "FACTURABLE"
          : sf === "A_VERIFIER"
          ? "A VERIFIER"
          : sf}
      </span>

      {motif && (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            padding: "4px 8px",
            borderRadius: "8px",
            fontSize: "12px",
            fontWeight: 500,
            background: "#eef2f7",
            color: "#374151",
          }}
        >
          {motif}
        </span>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────

function formatFrDate(v?: string | null) {
  if (!v) return "—";
  if (/^\d{2}\/\d{2}\/\d{4}/.test(v)) return v;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function croisementKind(s?: string | null): BadgeKind {
  if (s === "OK") return "green";
  if (s === "ABSENT_PRAXEDO") return "yellow";
  if (s === "ABSENT_PIDI") return "red";
  return "gray";
}

function statutFinalKind(s?: string | null): BadgeKind {
  if (s === "FACTURABLE") return "green";
  if (s === "NON_FACTURABLE") return "red";
  if (s === "CONDITIONNEL") return "yellow";
  if (s === "A_VERIFIER") return "orange";
  return "gray";
}

function motifKind(m?: string | null): BadgeKind {
  const x = (m ?? "").toUpperCase();
  if (x === "CROISEMENT_INCOMPLET") return "orange";
  if (x === "REGLE_MANQUANTE") return "orange";
  if (x === "ACTPROD_MANQUANT") return "orange";
  if (x === "CLOTURE_INVALIDE") return "orange";
  if (x === "PREVISITE") return "slate";
  if (x === "NON_FACTURABLE_REGLE") return "slate";
  return "gray";
}

function motifLabel(m?: string | null): string {
  const x = (m ?? "").toUpperCase();
  if (!x) return "—";
  switch (x) {
    case "CROISEMENT_INCOMPLET": return "Croisement incomplet";
    case "REGLE_MANQUANTE": return "Règle manquante";
    case "ACTPROD_MANQUANT": return "Act/Prod manquant";
    case "CLOTURE_INVALIDE": return "Clôture invalide";
    case "PREVISITE": return "Prévisite";
    case "NON_FACTURABLE_REGLE": return "Non facturable (règle)";
    default: return x.replaceAll("_", " ");
  }
}

function clotureKind(code?: string | null): BadgeKind {
  if (!code) return "gray";
  const c = code.toUpperCase();
  if (c === "DMS") return "green";
  if (["DEF", "RRC", "TSO", "PDC"].includes(c)) return "purple";
  return "blue";
}

function pidiLabel(d: DossierFacturable) {
  return d.statut_pidi ? "Validé par PIDI" : "Non envoyé à PIDI";
}

function terrainKind(mode?: string | null): BadgeKind {
  const m = (mode ?? "").toUpperCase();
  if (m.includes("IMM")) return "indigo";
  if (m.includes("SOUT")) return "cyan";
  if (m.includes("AER")) return "fuchsia";
  return "slate";
}

function parseAnyList(v?: string | null): string[] {
  if (!v) return [];
  return String(v).split(/[\r\n,;|]+/g).map((x) => x.trim()).filter(Boolean);
}

function parsePidiBrutCodes(v?: string | null): string[] {
  if (!v) return [];
  const s = String(v).toUpperCase();
  const matches = s.match(/\b[A-Z]{2,}[A-Z0-9]{0,12}\b/g) ?? [];
  return Array.from(new Set(matches.map((x) => x.trim()).filter(Boolean).filter((x) => x !== "PIDI" && x !== "BRUT")));
}

function SectionTitle({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
      {right}
    </div>
  );
}

function KeyValue({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-2 text-sm">
      <div className="text-gray-500">{k}</div>
      <div className="col-span-2 text-gray-900">{v}</div>
    </div>
  );
}

function groupByPpd(items: DossierFacturable[]) {
  const m = new Map<string, DossierFacturable[]>();
  for (const d of items) {
    const key = d.statut_pidi ? ((d.numero_ppd ?? "").trim() || "SANS_PPD") : "— (sans PIDI)";
    if (!m.has(key)) m.set(key, []);
    m.get(key)!.push(d);
  }
  return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
}

function Pagination({ page, pageCount, onPrev, onNext, onGo }: {
  page: number; pageCount: number;
  onPrev: () => void; onNext: () => void; onGo: (p: number) => void;
}) {
  if (pageCount <= 1) return null;
  return (
    <div className="flex items-center gap-2 text-sm">
      <button className="border rounded px-2 py-1 hover:bg-gray-50 disabled:opacity-50" onClick={onPrev} disabled={page <= 1}>Précédent</button>
      <span className="text-gray-700">Page <b>{page}</b> / {pageCount}</span>
      <button className="border rounded px-2 py-1 hover:bg-gray-50 disabled:opacity-50" onClick={onNext} disabled={page >= pageCount}>Suivant</button>
      <select className="border rounded px-2 py-1" value={page} onChange={(e) => onGo(Number(e.target.value))}>
        {Array.from({ length: pageCount }, (_, i) => i + 1).map((p) => <option key={p} value={p}>{p}</option>)}
      </select>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────

export default function DossiersList() {
  const router = useRouter();

  const [showOrangeSection, setShowOrangeSection] = useState(false);
  const [showDossiersSection, setShowDossiersSection] = useState(true);

  const [items, setItems] = useState<DossierFacturable[]>([]);
  const [rawItems, setRawItems] = useState<DossierFacturable[]>([]);
  const [filters, setFilters] = useState<DossiersFilters>({ limit: 5000, offset: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [grouped, setGrouped] = useState(false);
  const [dossiersPage, setDossiersPage] = useState(1);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selected, setSelected] = useState<DossierFacturable | null>(null);
  const [showRawTerrain, setShowRawTerrain] = useState(false);

  const [importType, setImportType] = useState<"PRAXEDO" | "PIDI" | "ORANGE_PPD" | "COMMENTAIRE_TECH" | "PRAXEDO_CR10" | null>(null);

  const [showTruncateConfirm, setShowTruncateConfirm] = useState(false);
  const [isTruncating, setIsTruncating] = useState(false);

  // Vrai dès que le token est disponible dans localStorage
  const [authReady, setAuthReady] = useState(false);

  // --- NOUVEAU: État pour savoir si l'utilisateur peut voir la section Orange ---
  const [canAccessOrange, setCanAccessOrange] = useState(false);
  // -----------------------------------------------------------------------------

  // ─── LOAD DOSSIERS ──────────────────────────────────────────────────────
  const dossiersAbortRef = React.useRef<AbortController | null>(null);

  const load = useCallback(async (f?: DossiersFilters) => {
    const activeFilters = f ?? filters;
    const normalized: DossiersFilters = {
      ...activeFilters, limit: 5000, offset: 0,
      q: activeFilters.q?.replace(/[<>]/g, ""),
    };

    dossiersAbortRef.current?.abort();
    const controller = new AbortController();
    dossiersAbortRef.current = controller;

    setLoading(true);
    setError(null);

    try {
      const data = await listDossiers(normalized, controller.signal);
      setRawItems(data);
      setItems(data);
      setDossiersPage(1);
      if (f) setFilters(normalized);
    } catch (e: any) {
      if (e?.name === "AbortError") return;
      setRawItems([]); setItems([]);
      setError(e?.message || "Erreur inconnue");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [filters]);

  // ─── Détection du token et du rôle admin ─────────────────────────────────
  useEffect(() => {
    const token = localStorage.getItem("token");
    setAuthReady(!!token);
    // --- NOUVEAU: Vérifier si l'utilisateur est admin ---
    setCanAccessOrange(isAdmin());
    // ------------------------------------------------
  }, []);

  // ─── Chargement initial des dossiers ────────────────────────────────────
  useEffect(() => {
    if (!authReady) return;
    load();
  }, [authReady, load]);

  // ─── Reload au focus ────────────────────────────────────────────────────
  useEffect(() => {
    if (!authReady) return;

    const onFocus = () => {
      if (items.length === 0) {
        load();
      }
    };

    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [authReady, items.length, load]);

  // ─── Derived ────────────────────────────────────────────────────────────
  const ppdOptions = useMemo(() => {
    const xs = rawItems.map((d) => (d.numero_ppd ?? "").trim()).filter(Boolean);
    return Array.from(new Set(xs)).sort((a, b) => a.localeCompare(b));
  }, [rawItems]);

  const hasAnyPidi = useMemo(() => rawItems.some((d) => !!d.statut_pidi), [rawItems]);

  const countByCroisement = useMemo(() => {
    const m = new Map<string, number>();
    for (const it of items) { const k = it.statut_croisement ?? "INCONNU"; m.set(k, (m.get(k) ?? 0) + 1); }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [items]);

  const countByPpd = useMemo(() => {
    const m = new Map<string, number>();
    for (const it of items) {
      if (!it.statut_pidi) continue;
      const k = (it.numero_ppd ?? "").trim() || "SANS_PPD";
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [items]);

  const countByMotif = useMemo(() => {
    const m = new Map<string, number>();
    for (const it of items) { const k = (it.motif_verification ?? "").trim(); if (k && k !== "—") m.set(k, (m.get(k) ?? 0) + 1); }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [items]);

  const dossiersPageCount = useMemo(() => Math.max(1, Math.ceil(items.length / PAGE_SIZE)), [items.length]);
  const dossiersPageItems = useMemo(() => {
    const start = (dossiersPage - 1) * PAGE_SIZE;
    return items.slice(start, start + PAGE_SIZE);
  }, [items, dossiersPage]);

  const groupedEntries = useMemo(() => groupByPpd(items), [items]);

  const selectedTerrainArticles = useMemo(() => {
    if (!selected) return [];
    return parseAnyList(selected.article_facturation_propose).map((x) => x.toUpperCase());
  }, [selected]);

  const selectedPidiCodes = useMemo(() => {
    if (!selected) return [];
    return parsePidiBrutCodes(selected.liste_articles);
  }, [selected]);

  async function exportExcel() {
    setIsExporting(true);
    try { await exportDossiersXlsx(filters); }
    catch (e: any) { setError(e?.message || "Export Excel échoué."); }
    finally { setIsExporting(false); }
  }

  function openDrawer(d: DossierFacturable) { setSelected(d); setDrawerOpen(true); setShowRawTerrain(false); }
  function closeDrawer() { setDrawerOpen(false); setSelected(null); setShowRawTerrain(false); }

  // ─── Truncate ───────────────────────────────────────────────────────────
  const handleTruncateAll = async () => {
    setIsTruncating(true);
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8100"}/api/admin/truncate-all`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("token")}` },
      });
      if (!response.ok) throw new Error(`Erreur ${response.status}: ${await response.text()}`);
      const result = await response.json();
      alert(`✅ Tables vidées !\n${result.message || ""}`);
      load({ limit: 5000, offset: 0 });
      // Forcer le rechargement de la section Orange si elle est visible
      if (showOrangeSection) {
        sessionStorage.removeItem("kyntus_orange_data_state_v2");
      }
    } catch (e: any) {
      setError(e?.message || "Erreur lors du vidage");
    } finally {
      setIsTruncating(false);
      setShowTruncateConfirm(false);
    }
  };

  // escape drawer
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && drawerOpen) { setDrawerOpen(false); setSelected(null); setShowRawTerrain(false); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  return (
    <div className="space-y-4">
      <style jsx>{`
        [data-details-btn] {
          background: #f36868; border: 1px solid #f36868; color: #ffffff;
          display: inline-flex; align-items: center; justify-content: center; text-align: center;
        }
        [data-details-btn]:hover { background: #d65c5c; border-color: #d65c5c; }
      `}</style>

      <FiltersBar
        onSearch={(f) => { const nf = { ...filters, ...f, offset: 0 }; setFilters(nf); load(nf); }}
        loading={loading} statuts={statutsFinal} ppds={ppdOptions}
      />

      {error && (
        <div className="mx-2 p-2 rounded border border-red-200 bg-red-50 text-sm text-red-700">{error}</div>
      )}

      {/* ACTIONS */}
      <div className="flex items-center justify-between px-2">
        <div className="text-sm text-gray-600">{loading ? "Chargement…" : `${items.length} dossiers`}</div>
        <div className="flex items-center gap-2 flex-wrap">
          <label className="inline-flex items-center gap-2 text-sm border rounded px-3 py-2 bg-white cursor-pointer hover:bg-gray-50">
            <input type="checkbox" checked={showDossiersSection} onChange={(e) => setShowDossiersSection(e.target.checked)} />
            Afficher Dossiers
          </label>

          {canAccessOrange && (
            <label className="inline-flex items-center gap-2 text-sm border rounded px-3 py-2 bg-white cursor-pointer hover:bg-gray-50">
              <input
                type="checkbox"
                checked={showOrangeSection}
                onChange={(e) => setShowOrangeSection(e.target.checked)}
              />
              Afficher Orange
            </label>
          )}

          {canAccessOrange && (
            <button
              onClick={() => router.push("/admin")}
              className="inline-flex items-center gap-2 px-3 py-2 rounded bg-slate-800 text-white hover:bg-slate-900"
            >
              Administration
            </button>
          )}

          <button onClick={() => load(filters)} disabled={loading} className="inline-flex items-center gap-2 px-3 py-2 rounded border bg-white hover:bg-gray-50 disabled:opacity-60">
            <RefreshCw className="h-4 w-4" /> Rafraîchir
          </button>
          <button onClick={() => setGrouped((x) => !x)} className="inline-flex items-center gap-2 px-3 py-2 rounded border bg-white hover:bg-gray-50">
            <Layers className="h-4 w-4" /> {grouped ? "Vue dossiers" : "Regrouper PPD"}
          </button>
          <button onClick={() => setImportType("COMMENTAIRE_TECH")} className="inline-flex items-center gap-2 px-3 py-2 rounded bg-purple-500 text-white hover:bg-purple-600">
            <Upload className="h-4 w-4" /> Commentaire tech / Palier
          </button>
          <button onClick={() => setImportType("PRAXEDO")} className="inline-flex items-center gap-2 px-3 py-2 rounded border bg-white hover:bg-gray-50">
            <Upload className="h-4 w-4" /> Praxedo
          </button>
          <button onClick={() => setImportType("PIDI")} className="inline-flex items-center gap-2 px-3 py-2 rounded border bg-white hover:bg-gray-50">
            <Upload className="h-4 w-4" /> PIDI
          </button>
          <button onClick={() => setShowTruncateConfirm(true)} disabled={isTruncating} className="inline-flex items-center gap-2 px-3 py-2 rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-60">
            <Trash2 className="h-4 w-4" /> {isTruncating ? "Vidage..." : "Vider tout"}
          </button>
          <button onClick={exportExcel} disabled={isExporting || items.length === 0} className="inline-flex items-center gap-2 px-3 py-2 rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60">
            <Download className="h-4 w-4" /> {isExporting ? "Export…" : "Exporter Excel"}
          </button>
        </div>
      </div>

      {/* STATS */}
      <div className="px-2 space-y-3">
        <div>
          <div className="text-sm text-gray-700 mb-2">Répartition (croisement) :</div>
          <div className="flex flex-wrap gap-2">
            {countByCroisement.map(([k, v]) => (
              <div key={k} className="flex items-center gap-2">
                <Badge txt={k.replaceAll("_", " ")} kind={croisementKind(k)} />
                <span className="text-sm text-gray-700">{v}</span>
              </div>
            ))}
          </div>
        </div>
        {hasAnyPidi ? (
          <div>
            <div className="text-sm text-gray-700 mb-2">Répartition (PPD) :</div>
            <div className="flex flex-wrap gap-2">
              {countByPpd.slice(0, 20).map(([k, v]) => (
                <div key={k} className="flex items-center gap-2">
                  <Badge txt={k} kind={k === "SANS_PPD" ? "rose" : "lime"} />
                  <span className="text-sm text-gray-700">{v}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div>
            <div className="text-sm text-gray-700 mb-2">Répartition (PPD) :</div>
            <div className="text-sm text-gray-500">Importer PIDI pour afficher la répartition PPD.</div>
          </div>
        )}
        {countByMotif.length > 0 && (
          <div>
            <div className="text-sm text-gray-700 mb-2">Répartition (motif) :</div>
            <div className="flex flex-wrap gap-2">
              {countByMotif.slice(0, 12).map(([k, v]) => (
                <div key={k} className="flex items-center gap-2">
                  <Badge txt={motifLabel(k)} kind={motifKind(k)} />
                  <span className="text-sm text-gray-700">{v}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ORANGE SECTION */}
      {canAccessOrange && (
        <OrangeComparisonSection
          visible={showOrangeSection}
          onImportOrange={() => setImportType("ORANGE_PPD")}
          onScrapeMissing={(rows) => {
            const missing = rows
              .filter((r) =>
                ["RELEVE_ABSENT_PIDI", "CAC_ABSENT_PIDI", "OT_INEXISTANT", "CROISEMENT_INCOMPLET", "ABSENT_PIDI"].includes(
                  String(r.reason || "").toUpperCase()
                )
              )
              .map((r) => ({
                n_cac: String(r.num_ot || "").trim(),
                releve: String(r.releve || "").trim(),
                numero_ppd_orange: r.numero_ppd_orange ? String(r.numero_ppd_orange).trim() : null,
              }))
              .filter((x) => x.n_cac && x.releve);

            const unique = Array.from(
              new Map(missing.map((x) => [`${x.n_cac}__${x.releve}`, x])).values()
            );

            if (!unique.length) {
              alert("✅ Aucun couple CAC / relevé manquant à scraper !");
              return;
            }

            sessionStorage.setItem("kyntus_missing_pairs", JSON.stringify(unique));
            sessionStorage.removeItem("kyntus_missing_releves");
            router.push("/scraper");
          }}
        />
      )}

      {/* DOSSIERS SECTION */}
      {showDossiersSection && (
        <div className="border rounded-lg overflow-auto bg-white mx-2">
          <div className="flex items-center justify-between px-3 py-2 border-b bg-gray-50">
            <div className="text-sm font-semibold">Dossiers</div>
            {!grouped && <Pagination page={dossiersPage} pageCount={dossiersPageCount} onPrev={() => setDossiersPage((p) => Math.max(1, p - 1))} onNext={() => setDossiersPage((p) => Math.min(dossiersPageCount, p + 1))} onGo={setDossiersPage} />}
          </div>
          <table className="min-w-[2000px] w-full text-sm">
            <thead className="bg-gray-50">
              <tr className="text-left">
                <th className="p-3">OT</th><th className="p-3">ND</th><th className="p-3">PPD</th>
                <th className="p-3">Attachement</th><th className="p-3">Act.</th><th className="p-3">Prod.</th>
                <th className="p-3">Code cible</th><th className="p-3">Clôture</th><th className="p-3">Terrain</th>
                <th className="p-3">Règle</th><th className="p-3">Statut final</th><th className="p-3">Croisement</th>
                <th className="p-3">Praxedo</th><th className="p-3">PIDI</th><th className="p-3">Palier</th>
                <th className="p-3">Actions</th><th className="p-3">Planifiée</th><th className="p-3"></th>
               </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr><td colSpan={18} className="p-6 text-center text-gray-500">{loading ? "Chargement…" : "Aucun dossier à afficher."}</td></tr>
              ) : !grouped ? (
                dossiersPageItems.map((d) => {
                  const cro = d.statut_croisement ?? "INCONNU";
                  return (
                    <tr key={d.key_match} className="border-t hover:bg-gray-50/50 cursor-pointer" onClick={() => openDrawer(d)}>
                      <td className="p-3 font-mono">{d.ot_key ?? "—"}</td>
                      <td className="p-3 font-mono">{d.nd_global ?? "—"}</td>
                      <td className="p-3 font-mono">{d.numero_ppd ?? "—"}</td>
                      <td className="p-3">{d.attachement_valide ?? "—"}</td>
                      <td className="p-3">{d.activite_code ?? "—"}</td>
                      <td className="p-3">{d.produit_code ?? "—"}</td>
                      <td className="p-3">{d.code_cible ?? "—"}</td>
                      <td className="p-3">{d.code_cloture_code ? <Badge txt={d.code_cloture_code} kind={clotureKind(d.code_cloture_code)} /> : "—"}</td>
                      <td className="p-3">{d.mode_passage ? <Badge txt={d.mode_passage} kind={terrainKind(d.mode_passage)} /> : <span className="text-gray-500">—</span>}</td>
                      <td className="p-3"><div className="max-w-[520px] truncate" title={d.libelle_regle ?? ""}>{d.libelle_regle ?? "—"}</div></td>
                      <td className="p-3"><StatusFinalCell dossier={d} /></td>
                      <td className="p-3"><Badge txt={cro.replaceAll("_", " ")} kind={croisementKind(cro)} /></td>
                      <td className="p-3">{d.statut_praxedo ? <Badge txt={d.statut_praxedo} kind={d.statut_praxedo.toLowerCase().includes("valid") ? "green" : "gray"} /> : "—"}</td>
                      <td className="p-3"><span className="text-purple-700 font-medium">{pidiLabel(d)}</span></td>
                      <td className="p-3">{d.palier ? <Badge txt={d.palier.replaceAll("_", " ")} kind="lightBlue" /> : <span className="text-gray-500">—</span>}</td>
                      <td className="p-3">
                        <button onClick={(e) => { e.stopPropagation(); openDrawer(d); }} data-details-btn className={DETAILS_BTN_CLASS}>Détails</button>
                      </td>
                      <td className="p-3">{formatFrDate(d.date_planifiee)}</td>
                      <td className="p-3"><ChevronRight className="h-4 w-4 text-gray-400" /></td>
                    </tr>
                  );
                })
              ) : (
                groupedEntries.map(([ppd, rows]) => (
                  <tr key={ppd} className="border-t">
                    <td colSpan={18} className="p-0">
                      <div className="px-3 py-2 bg-gray-50 border-b flex items-center gap-3">
                        <span className="text-sm font-semibold">PPD: <span className="font-mono">{ppd}</span></span>
                        <span className="text-xs text-gray-600">{rows.length} dossiers</span>
                      </div>
                      <div className="overflow-auto">
                        <table className="min-w-[2000px] w-full text-sm">
                          <tbody>
                            {rows.map((d) => {
                              const cro = d.statut_croisement ?? "INCONNU";
                              return (
                                <tr key={d.key_match} className="border-b hover:bg-gray-50/50 cursor-pointer" onClick={() => openDrawer(d)}>
                                  <td className="p-3 font-mono w-[160px]">{d.ot_key ?? "—"}</td>
                                  <td className="p-3 font-mono w-[160px]">{d.nd_global ?? "—"}</td>
                                  <td className="p-3 font-mono w-[160px]">{d.numero_ppd ?? "—"}</td>
                                  <td className="p-3 w-[160px]">{d.attachement_valide ?? "—"}</td>
                                  <td className="p-3 w-[80px]">{d.activite_code ?? "—"}</td>
                                  <td className="p-3 w-[80px]">{d.produit_code ?? "—"}</td>
                                  <td className="p-3 w-[120px]">{d.code_cible ?? "—"}</td>
                                  <td className="p-3 w-[110px]">{d.code_cloture_code ? <Badge txt={d.code_cloture_code} kind={clotureKind(d.code_cloture_code)} /> : "—"}</td>
                                  <td className="p-3 w-[120px]">{d.mode_passage ? <Badge txt={d.mode_passage} kind={terrainKind(d.mode_passage)} /> : <span className="text-gray-500">—</span>}</td>
                                  <td className="p-3 w-[520px]"><div className="max-w-[520px] truncate" title={d.libelle_regle ?? ""}>{d.libelle_regle ?? "—"}</div></td>
                                  <td className="p-3 w-[220px]"><StatusFinalCell dossier={d} /></td>
                                  <td className="p-3 w-[140px]"><Badge txt={cro.replaceAll("_", " ")} kind={croisementKind(cro)} /></td>
                                  <td className="p-3 w-[140px]">{d.statut_praxedo ? <Badge txt={d.statut_praxedo} kind={d.statut_praxedo.toLowerCase().includes("valid") ? "green" : "gray"} /> : "—"}</td>
                                  <td className="p-3 w-[160px]"><span className="text-purple-700 font-medium">{pidiLabel(d)}</span></td>
                                  <td className="p-3 w-[100px]">{d.palier ? <Badge txt={d.palier.replaceAll("_", " ")} kind="lightBlue" /> : <span className="text-gray-500">—</span>}</td>
                                  <td className="p-3 w-[80px]"><button onClick={(e) => { e.stopPropagation(); openDrawer(d); }} data-details-btn className={DETAILS_BTN_CLASS}>Détails</button></td>
                                  <td className="p-3 w-[170px]">{formatFrDate(d.date_planifiee)}</td>
                                  <td className="p-3 w-[40px]"><ChevronRight className="h-4 w-4 text-gray-400" /></td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* DRAWER */}
      {drawerOpen && selected && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/30" onClick={closeDrawer} />
          <div className="absolute right-0 top-0 h-full w-full max-w-[520px] bg-white shadow-2xl border-l flex flex-col">
            <div className="px-5 py-4 border-b flex items-start justify-between">
              <div className="space-y-1">
                <div className="text-xs text-gray-500">Détails dossier</div>
                <div className="text-lg font-semibold">
                  <span className="font-mono">{selected.ot_key ?? "—"}</span>
                  <span className="text-gray-400"> • </span>
                  <span className="font-mono">{selected.nd_global ?? "—"}</span>
                </div>
                <div className="flex flex-wrap gap-2 pt-1">
                  <Badge txt={(selected.statut_final ?? "—").replaceAll("_", " ")} kind={statutFinalKind(selected.statut_final)} />
                  <Badge txt={(selected.statut_croisement ?? "INCONNU").replaceAll("_", " ")} kind={croisementKind(selected.statut_croisement)} />
                  {selected.is_previsite && <Badge txt="Prévisite" kind="slate" />}
                  {selected.motif_verification && <Badge txt={motifLabel(selected.motif_verification)} kind={motifKind(selected.motif_verification)} />}
                </div>
              </div>
              <button onClick={closeDrawer} className="text-gray-500 hover:text-gray-800" aria-label="Fermer"><X className="h-5 w-5" /></button>
            </div>

            <div className="flex-1 overflow-auto p-5 space-y-5">
              <div className="rounded-lg border bg-white p-4 space-y-3">
                <SectionTitle title="Résumé" right={<Info className="h-4 w-4 text-gray-400" />} />
                <div className="space-y-2">
                  <KeyValue k="Activité / Produit" v={<span className="font-medium">{selected.activite_code ?? "—"} / {selected.produit_code ?? "—"}</span>} />
                  <KeyValue k="Code cible" v={selected.code_cible ?? "—"} />
                  <KeyValue k="PPD" v={<span className="font-mono">{selected.numero_ppd ?? "—"}</span>} />
                  <KeyValue k="Attachement validé" v={selected.attachement_valide ?? "—"} />
                  <KeyValue k="Clôture" v={selected.code_cloture_code ? <Badge txt={selected.code_cloture_code} kind={clotureKind(selected.code_cloture_code)} /> : "—"} />
                  <KeyValue k="Motif" v={selected.motif_verification ? <Badge txt={motifLabel(selected.motif_verification)} kind={motifKind(selected.motif_verification)} /> : <span className="text-gray-500">—</span>} />
                  <KeyValue k="Palier" v={selected.palier ? <Badge txt={selected.palier.replaceAll("_", " ")} kind="lightBlue" /> : "—"} />
                  <KeyValue k="Palier (phrase)" v={selected.palier_phrase ?? "—"} />
                  <KeyValue k="Planifiée" v={formatFrDate(selected.date_planifiee)} />
                  <KeyValue k="Technicien" v={selected.technicien ?? "—"} />
                </div>
              </div>

              <div className="rounded-lg border bg-white p-4 space-y-3">
                <SectionTitle title="Terrain (PBO / passage)" right={
                  <button className="text-xs text-blue-700 hover:underline" onClick={() => setShowRawTerrain((x) => !x)}>
                    {showRawTerrain ? "Masquer texte source" : "Voir texte source"}
                  </button>
                } />

                <div className="space-y-2 pt-2 border-b border-gray-100 pb-3">
                  <div className="text-xs font-medium text-gray-700">Commentaire technique</div>
                  {(() => {
                    const description = selected?.description || "";
                    const compteRendu = selected?.compte_rendu || "";
                    let commentaire: string | null = null;
                    const blocNoteMatch = description.match(/Bloc-note:\s*(.+?)(?:\n|$)/i);
                    if (blocNoteMatch?.[1]) commentaire = blocNoteMatch[1].trim();
                    if (!commentaire && compteRendu) {
                      const crMatch = compteRendu.replace(/\u00a0/g, " ").match(/#commentairereleve\s*=\s*([^#]+)/i);
                      if (crMatch?.[1]) commentaire = crMatch[1].trim();
                    }
                    const aPlp = !!commentaire?.toLowerCase().includes("plp");
                    const aPto = !!commentaire?.toLowerCase().includes("pto");
                    const aMutation = !!/muter?|mutation/i.test(commentaire ?? "");
                    return commentaire ? (
                      <div className="rounded border bg-gray-50 p-3">
                        <div className="text-xs text-gray-600 break-words whitespace-pre-wrap">"{commentaire}"</div>
                        <div className="mt-2 flex flex-wrap gap-1">
                          {aPlp && <Badge txt="PLP détecté" kind="orange" />}
                          {aPto && <Badge txt="PTO mentionné" kind="blue" />}
                          {aMutation && <Badge txt="Mutation" kind="purple" />}
                        </div>
                      </div>
                    ) : <div className="text-xs text-gray-400 italic">Aucun commentaire technique trouvé</div>;
                  })()}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg border bg-gray-50 p-3">
                    <div className="text-xs text-gray-500 mb-1">Mode passage</div>
                    <div className="text-sm font-medium">{selected?.mode_passage ? <Badge txt={selected.mode_passage} kind={terrainKind(selected.mode_passage)} /> : <span className="text-gray-500">—</span>}</div>
                  </div>
                  <div className="rounded-lg border bg-gray-50 p-3">
                    <div className="text-xs text-gray-500 mb-1">Type site</div>
                    <div className="text-sm font-medium">{selected?.type_site_terrain || "—"}</div>
                  </div>
                  <div className="rounded-lg border bg-gray-50 p-3 col-span-2">
                    <div className="text-xs text-gray-500 mb-1">Type PBO</div>
                    <div className="text-sm font-medium">{selected?.type_pbo_terrain ?? "—"}</div>
                  </div>
                </div>

                <div className="pt-2">
                  <div className="text-xs text-gray-500 mb-2">Articles terrain proposés</div>
                  {selectedTerrainArticles.length
                    ? <div className="flex flex-wrap gap-1">{selectedTerrainArticles.map((a) => <Chip key={a} txt={a} />)}</div>
                    : <div className="text-sm text-gray-500">—</div>}
                </div>

                {showRawTerrain && (
                  <div className="space-y-2">
                    {[
                      { label: "desc_site", val: selected?.desc_site },
                      { label: "description", val: selected?.description },
                      { label: "compte_rendu", val: selected?.compte_rendu },
                      { label: "evenements", val: selected?.evenements },
                    ].map(({ label, val }) => (
                      <div key={label} className="rounded border bg-gray-50 p-3">
                        <div className="text-xs text-gray-500 mb-1">{label} (source)</div>
                        <pre className="whitespace-pre-wrap break-words text-xs text-gray-800 max-h-60 overflow-auto">{val || "—"}</pre>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-lg border bg-white p-4 space-y-3">
                <SectionTitle title="Règle appliquée" />
                <div className="space-y-2">
                  <KeyValue k="Code règle" v={<span className="font-mono">{selected.regle_code ?? "—"}</span>} />
                  <KeyValue k="Libellé" v={selected.libelle_regle ?? "—"} />
                  <KeyValue k="Statut facturation" v={selected.statut_facturation ?? "—"} />
                  <KeyValue k="Clôtures facturables" v={
                    selected.codes_cloture_facturables?.length
                      ? <div className="flex flex-wrap gap-1">{selected.codes_cloture_facturables.map((c) => <Chip key={c} txt={c} />)}</div>
                      : <span className="text-gray-500">—</span>
                  } />
                </div>
              </div>

              <div className="rounded-lg border bg-white p-4 space-y-3">
                <SectionTitle title="Articles PIDI (brut)" />
                <div className="rounded border bg-gray-50 p-3">
                  <div className="text-xs text-gray-500 mb-2">Tokens</div>
                  {selectedPidiCodes.length
                    ? <div className="flex flex-wrap gap-1">{selectedPidiCodes.map((a) => <Chip key={a} txt={a} />)}</div>
                    : <div className="text-sm text-gray-500">—</div>}
                </div>
                <div className="rounded border bg-gray-50 p-3">
                  <div className="text-xs text-gray-500 mb-2">Texte source</div>
                  <pre className="whitespace-pre-wrap break-words text-xs text-gray-800">{selected.liste_articles ?? "—"}</pre>
                </div>
              </div>
            </div>

            <div className="border-t p-4 flex items-center justify-between">
              <div className="text-xs text-gray-500">ESC pour fermer</div>
              <button onClick={closeDrawer} className="border rounded px-3 py-2 hover:bg-gray-50">Fermer</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal confirmation vidage */}
      {showTruncateConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowTruncateConfirm(false)} />
          <div className="relative bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">⚠️ Confirmation de vidage</h3>
            <p className="text-sm text-gray-700 mb-2">Êtes-vous sûr de vouloir vider toutes les tables ?</p>
            <p className="text-sm text-red-600 font-medium">Cette action est irréversible !</p>
            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => setShowTruncateConfirm(false)} className="px-4 py-2 border rounded hover:bg-gray-50">Annuler</button>
              <button onClick={handleTruncateAll} disabled={isTruncating} className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-60">
                {isTruncating ? "Vidage en cours..." : "Confirmer le vidage"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Import modal */}
      {importType && (
        <FileUploadModal
          type={importType}
          onImported={(payload) => {
            const t = importType;
            setImportType(null);
            load(filters);

            if (t === "ORANGE_PPD") {
              sessionStorage.removeItem("kyntus_orange_data_state_v2");
            }
          }}
          onClose={() => setImportType(null)}
        />
      )}
    </div>
  );
}