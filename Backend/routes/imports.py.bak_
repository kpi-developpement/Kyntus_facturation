#Backend/routes/imports.py
from __future__ import annotations

import os
import csv
import re
import json
import math
import unicodedata
from datetime import datetime
from decimal import Decimal, InvalidOperation
from io import TextIOWrapper
from typing import Any
from collections.abc import Iterator

from fastapi import APIRouter, UploadFile, File, Depends, HTTPException, Form, Query
from sqlalchemy.orm import Session
from sqlalchemy.dialects.postgresql import insert as pg_insert

from database.connection import get_db
from models.raw_praxedo import RawPraxedo
from models.raw_pidi import RawPidi
from models.raw_praxedo_cr10 import RawPraxedoCr10

from routes.auth import get_current_user
from models.user import User

router = APIRouter(prefix="/api/import", tags=["imports"])
DEBUG_IMPORTS = os.getenv("DEBUG_IMPORTS", "0") == "1"

CLOTURE_CODES = {
    "DMS", "DEF", "RRC", "TSO", "PDC",
    "DMP", "DMA", "DMC", "DME", "DMI", "DMR", "DMT", "DMX",
    "TVC", "ETU", "RMC", "RMF", "ORT", "MAJ", "TKO", "REA",
}

PALIER_NUM_RE = re.compile(r"\bpalier\s*([123])\b", re.IGNORECASE)


def _extract_palier_from_evenements(evenements: str | None) -> str | None:
    if not evenements:
        return None
    s = (evenements or "").strip()
    if not s:
        return None

    m = PALIER_NUM_RE.search(s)
    if m:
        return f"PALIER_{m.group(1)}"

    low = s.lower()
    if ("aucun" in low or "aucunes" in low) and ("regle" in low or "règle" in low) and ("applic" in low):
        return "PALIER_1"

    return None


def _norm(s: str) -> str:
    s = (s or "").replace("\ufeff", "").strip().lower()
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = s.replace("°", "").replace("’", "'")
    s = re.sub(r"\s+", "_", s)
    s = re.sub(r"[^a-z0-9_]+", "_", s)
    s = re.sub(r"_+", "_", s)
    return s.strip("_")


def _val(h: dict[str, Any], *keys: str) -> str | None:
    for k in keys:
        v = h.get(k)
        if v is not None and str(v).strip() != "":
            return str(v).strip()
    return None


def _fix_mojibake(s: str | None) -> str | None:
    if not s:
        return s
    t = str(s)
    if ("Ã" in t) or ("Â" in t):
        try:
            return t.encode("latin1", errors="ignore").decode("utf-8", errors="ignore")
        except Exception:
            return t
    return t


def _clean_text(s: str | None) -> str | None:
    if s is None:
        return None
    out = _fix_mojibake(str(s).strip())
    return out if out and out.strip() != "" else None


def _pick_first(old: str | None, new: str | None) -> str | None:
    if old is not None and str(old).strip() != "":
        return old
    if new is not None and str(new).strip() != "":
        return new
    return None


def _merge_articles(old: str | None, new: str | None) -> str | None:
    a = _clean_text(old)
    b = _clean_text(new)
    if not a and not b:
        return None
    if a and not b:
        return a
    if b and not a:
        return b

    def split_items(x: str) -> list[str]:
        parts = re.split(r"[,\n;|]+", x)
        return [p.strip() for p in parts if p and p.strip()]

    sa = split_items(a or "")
    sb = split_items(b or "")
    seen = set()
    merged: list[str] = []
    for it in sa + sb:
        key = it.lower()
        if key in seen:
            continue
        seen.add(key)
        merged.append(it)
    return ", ".join(merged) if merged else (a or b)


def _normalize_row(r: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for k, v in r.items():
        if k is None:
            continue
        nk = _norm(k)
        vv = v.strip() if isinstance(v, str) else v

        if nk in out and str(out.get(nk) or "").strip() != "":
            continue
        if str(vv or "").strip() == "" and nk in out:
            continue

        out[nk] = vv
    return out


def _sa_only_known_columns(model_cls, payload: dict) -> dict:
    allowed = set(model_cls.__table__.columns.keys())
    return {k: v for k, v in payload.items() if k in allowed}


def _digits_only(v: str | None) -> str | None:
    if not v:
        return None
    s = str(v).strip()
    try:
        f = float(s.replace(",", "."))
        if math.isfinite(f) and abs(f - int(f)) < 1e-9:
            s = str(int(f))
    except Exception:
        pass

    s = re.sub(r"\D+", "", s)
    s = s.lstrip("0")
    return s if s else None


def _detect_delimiter(file: UploadFile, requested: str) -> str:
    try:
        pos = file.file.tell()
    except Exception:
        pos = None

    try:
        head = file.file.read(8192)
        if pos is not None:
            file.file.seek(pos)

        txt = head.decode("utf-8-sig", errors="ignore")
        first = (txt.splitlines()[0] if txt else "")

        counts = {
            ";": first.count(";"),
            ",": first.count(","),
            "\t": first.count("\t"),
            "|": first.count("|"),
        }
        best = max(counts, key=counts.get)
        if counts[best] >= 3 and counts[best] >= (counts.get(requested, 0) + 2):
            return best

        if requested in counts and counts[requested] > 0:
            return requested

        try:
            sniffed = csv.Sniffer().sniff(txt, delimiters=[";", ",", "\t", "|"])
            return sniffed.delimiter
        except Exception:
            if counts["\t"] > 0:
                return "\t"
            return requested

    except Exception:
        return requested


def _read_header_and_reader(file: UploadFile, delimiter: str):
    try:
        file.file.seek(0)
    except Exception:
        pass

    text = TextIOWrapper(file.file, encoding="utf-8-sig", errors="ignore", newline="")
    reader = csv.DictReader(text, delimiter=delimiter)
    raw_headers = reader.fieldnames or []
    norm_headers = [_norm(h) for h in raw_headers]
    return raw_headers, norm_headers, reader


def _resolve_delimiter(delimiter_q: str | None, delimiter_form: str | None) -> str:
    d = (delimiter_q or delimiter_form or ";").strip()
    return d if d in {",", ";", "\t", "|"} else ";"


def _require_columns_strict(
    raw_headers: list[str],
    norm_headers: list[str],
    required: dict[str, set[str]],
    expected: str
) -> None:
    hs = set(norm_headers)
    missing: list[str] = []
    for display_name, variants in required.items():
        if not (hs & set(variants)):
            missing.append(display_name)

    if missing and len(raw_headers) <= 2:
        h0 = raw_headers[0] if raw_headers else ""
        if ("\t" in h0) or (";" in h0) or ("," in h0) or ("|" in h0):
            raise HTTPException(
                status_code=400,
                detail=f"CSV {expected}: séparateur incorrect (l'en-tête est lu comme 1 seule colonne). "
                       f"Essaye le séparateur TAB, ';' ou ',' selon ton export."
            )

    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"CSV {expected}: colonnes obligatoires manquantes: {', '.join(missing)}"
        )


PRAXEDO_REQUIRED = {
    "N°": {"numero", "n", "no", "ot", "numero_ot", "ot_key"},
    "Statut": {"statut"},
    "Planifiée": {"planifiee", "planifiee_au", "date_planifiee"},
    "Nom technicien": {"nom_technicien"},
    "Prénom technicien": {"prenom_technicien"},
    "Equipiers": {"equipiers"},
    "ND": {"nd"},
    "Act/Prod": {"act_prod", "act_prod_code", "activite_produit"},
    "Code intervention": {"code_intervention", "code_intervenant", "code_interven", "code_interv"},
    "CP": {"cp"},
    "Ville site": {"ville_site", "ville"},
    "Desc. site": {"desc_site"},
    "Description": {"description"},
}

PIDI_REQUIRED = {
    "Contrat": {"contrat"},
    "N° Flux PIDI": {"n_de_flux_pidi", "n_flux_pidi", "numero_flux_pidi", "flux_pidi"},
    "Type": {"type", "type_pidi", "type_attachement", "type_d_attachement"},
    "Statut": {"statut", "statut_attachement"},
    "ND": {"nd", "n_d", "ndi", "n_di", "numero_di", "numero_de_di"},
    "Code secteur": {"code_secteur", "secteur"},
    "N° OT": {"numero_ot", "n_ot", "ot", "ot_key", "numero_de_l_ot", "numero_intervention"},
    "N° att.": {"numero_att", "n_att", "n_att_", "n_attachement", "numero_attachement"},
    "OEIE": {"oeie"},
    "Code gestion chantier": {"code_gestion_chantier", "code_gestion", "codes_chantier_de_gestion"},
    "Agence": {"agence"},
    "N° PPD": {"n_ppd", "numero_ppd", "ppd", "n_pdd", "numero_pdd", "n__ppd"},
    "Bordereau": {"bordereau"},
    "HT": {"ht", "montant_ht", "prix_majore", "prix_majore_", "prix", "prix_majoré"},
    "Liste des articles": {"liste_des_articles", "liste_articles", "liste_d_articles", "article"},
    "N° CAC": {"n_cac"},
    "Comment. acqui./rejet": {"comment_acqui_rejet"},
    "Cause acqui./rejet": {"cause_acqui_rejet"},
}

PRAXEDO_CR10_REQUIRED = {
    "ID EXTERNE": {"id_externe", "idexterne", "id_externe_", "id_externe_ot"},
    "NOM SITE": {"nom_site", "nom_du_site", "site", "nomsite"},
    "COMPTE-RENDU": {"compte_rendu", "compterendu", "compte_rendu_"},
}


def _find_value_by_header_like(raw_row: dict[str, Any], *contains_all: str) -> str | None:
    wants = [w.lower() for w in contains_all]
    for k, v in raw_row.items():
        if not k or v is None:
            continue
        lk = str(k).lower()
        if all(w in lk for w in wants):
            s = str(v).strip()
            if s != "":
                return s
    return None


def _guess_cloture(h: dict[str, Any]) -> str | None:
    direct = _val(
        h,
        "code_cloture_code", "code_cloture", "cloture", "etat_cloture",
        "code_intervention", "code_intervenant", "code_interven", "code_interv",
    )
    if direct:
        d = direct.strip().upper()
        if d in CLOTURE_CODES:
            return d
        m = re.search(r"\b([A-Z]{3})\b", d)
        if m and m.group(1) in CLOTURE_CODES:
            return m.group(1)

    for k, v in h.items():
        if not v:
            continue
        kk = (k or "").lower()
        if ("clotur" in kk) or ("interven" in kk) or ("clot" in kk):
            vv = str(v).strip().upper()
            if vv in CLOTURE_CODES:
                return vv
            m = re.search(r"\b([A-Z]{3})\b", vv)
            if m and m.group(1) in CLOTURE_CODES:
                return m.group(1)

    for v in h.values():
        if not v:
            continue
        vv = str(v).strip().upper()
        if vv in CLOTURE_CODES:
            return vv
        m = re.search(r"\b([A-Z]{3})\b", vv)
        if m and m.group(1) in CLOTURE_CODES:
            return m.group(1)

    return None


def _pidi_dossier_key_safe(h: dict[str, Any], i: int, now: datetime) -> str:
    numero_ot = _clean_text(_val(h, "numero_ot", "n_ot", "ot", "ot_key", "numero_de_l_ot", "numero_intervention"))
    nd = _clean_text(_val(h, "nd", "n_d", "ndi", "n_di", "numero_di", "numero_de_di"))
    if (not numero_ot) and (not nd):
        return f"NO_OTND_{int(now.timestamp())}_{i}"
    return f"{numero_ot or 'NA'}|{nd or 'NA'}"


def _parse_ht(value: str | None) -> Decimal | None:
    v = _clean_text(value)
    if not v:
        return None
    v = v.replace(" ", "").replace("\u00a0", "")
    v = v.replace(",", ".")
    try:
        return Decimal(v)
    except InvalidOperation:
        return None


COMMENT_RELEVE_RE = re.compile(r"#commentairereleve\s*=\s*(.+)", re.IGNORECASE)


def _extract_commentaire_releve(compte_rendu: str | None) -> str | None:
    if not compte_rendu:
        return None
    s = _clean_text(compte_rendu) or ""
    m = COMMENT_RELEVE_RE.search(s)
    if not m:
        return None
    val = (m.group(1) or "").strip()
    return val if val else None

def _chunk_list(items: list[dict[str, Any]], size: int) -> Iterator[list[dict[str, Any]]]:
    for i in range(0, len(items), size):
        chunk = items[i:i + size]
        yield chunk

@router.post("/praxedo")
async def import_praxedo(
    file: UploadFile = File(...),
    delimiter_q: str | None = Query(None),
    delimiter: str = Form(";"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    try:
        d0 = _resolve_delimiter(delimiter_q, delimiter)
        eff_delim = _detect_delimiter(file, d0)

        raw_headers, norm_headers, reader = _read_header_and_reader(file, eff_delim)
        _require_columns_strict(raw_headers, norm_headers, PRAXEDO_REQUIRED, "PRAXEDO")

        now = datetime.utcnow()
        ds_non_null = 0
        by_key: dict[tuple[str, int], dict[str, Any]] = {}

        for raw_row in reader:
            if not raw_row:
                continue

            h = _normalize_row(raw_row)

            numero = _val(h, "numero", "n", "no", "ot", "numero_ot", "ot_key")
            if not numero:
                continue

            cloture = _guess_cloture(h)

            ds = _clean_text(_val(h, "desc_site", "desc__site"))
            if not ds:
                ds = _clean_text(
                    _find_value_by_header_like(raw_row, "desc", "site")
                    or _find_value_by_header_like(raw_row, "infos", "site")
                )

            desc = _clean_text(_val(h, "description"))

            if ds:
                ds_non_null += 1

            compte_rendu = _clean_text(
                _val(h, "compte_rendu", "compterendu", "compte__rendu", "compte_rendu_", "compte_rendu_praxedo")
            )
            if not compte_rendu:
                compte_rendu = _clean_text(
                    _find_value_by_header_like(raw_row, "compte", "rendu")
                    or _find_value_by_header_like(raw_row, "compte-rendu")
                )

            commentaire_releve = _extract_commentaire_releve(compte_rendu)

            extra_payload = {
                "compte_rendu": compte_rendu,
                "commentaire_releve": commentaire_releve,
            }

            obj_payload = {
                "numero": numero,
                "user_id": current_user.id,
                "statut": _val(h, "statut"),
                "planifiee": _val(h, "planifiee", "planifiee_au", "date_planifiee"),
                "nom_technicien": _val(h, "nom_technicien", "technicien"),
                "prenom_technicien": _val(h, "prenom_technicien"),
                "equipiers": _val(h, "equipiers"),
                "nd": _val(h, "nd"),
                "act_prod": _val(h, "act_prod", "activite_produit", "act_prod_code"),
                "code_intervenant": _val(h, "code_intervention", "code_intervenant", "code_interven", "code_interv") or cloture,
                "cp": _val(h, "cp"),
                "ville_site": _val(h, "ville_site", "ville"),
                "desc_site": ds,
                "description": desc,
                "compte_rendu": compte_rendu,
                "imported_at": now,
            }

            existing_extra = _val(h, "csv_extra")
            if existing_extra and str(existing_extra).strip():
                try:
                    old = json.loads(existing_extra)
                    if isinstance(old, dict):
                        old.update({k: v for k, v in extra_payload.items() if v is not None})
                        obj_payload["csv_extra"] = json.dumps(old, ensure_ascii=False)
                    else:
                        obj_payload["csv_extra"] = json.dumps(extra_payload, ensure_ascii=False)
                except Exception:
                    obj_payload["csv_extra"] = json.dumps(extra_payload, ensure_ascii=False)
            else:
                obj_payload["csv_extra"] = json.dumps(extra_payload, ensure_ascii=False)

            obj_payload = _sa_only_known_columns(RawPraxedo, obj_payload)
            by_key[(numero, current_user.id)] = obj_payload

        rows_list = list(by_key.values())
        if not rows_list:
            return {"ok": True, "rows": 0, "desc_site_non_null": 0, "delimiter_used": eff_delim}

        t = RawPraxedo.__table__
        stmt = pg_insert(t).values(rows_list)
        stmt = stmt.on_conflict_do_update(
            index_elements=[t.c.numero, t.c.user_id],
            set_={
                "statut": stmt.excluded.statut,
                "planifiee": stmt.excluded.planifiee,
                "nom_technicien": stmt.excluded.nom_technicien,
                "prenom_technicien": stmt.excluded.prenom_technicien,
                "equipiers": stmt.excluded.equipiers,
                "nd": stmt.excluded.nd,
                "act_prod": stmt.excluded.act_prod,
                "code_intervenant": stmt.excluded.code_intervenant,
                "cp": stmt.excluded.cp,
                "ville_site": stmt.excluded.ville_site,
                "desc_site": stmt.excluded.desc_site,
                "description": stmt.excluded.description,
                "compte_rendu": stmt.excluded.compte_rendu,
                "csv_extra": stmt.excluded.csv_extra,
                "imported_at": stmt.excluded.imported_at,
            },
        )

        db.execute(stmt)
        db.commit()

        return {"ok": True, "rows": len(rows_list), "desc_site_non_null": ds_non_null, "delimiter_used": eff_delim}

    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/pidi")
async def import_pidi(
    file: UploadFile = File(...),
    delimiter_q: str | None = Query(None),
    delimiter: str = Form(";"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    try:
        d0 = _resolve_delimiter(delimiter_q, delimiter)
        eff_delim = _detect_delimiter(file, d0)

        raw_headers, norm_headers, reader = _read_header_and_reader(file, eff_delim)
        _require_columns_strict(raw_headers, norm_headers, PIDI_REQUIRED, "PIDI")

        now = datetime.utcnow()
        agg: dict[str, dict[str, Any]] = {}
        rows_in = 0

        for i, raw_row in enumerate(reader):
            if not raw_row:
                continue
            rows_in += 1

            h = _normalize_row(raw_row)
            dossier_key = _pidi_dossier_key_safe(h, i, now)

            rec = agg.get(dossier_key)
            if rec is None:
                rec = {
                    "numero_flux_pidi": None,
                    "contrat": None,
                    "type_pidi": None,
                    "statut": None,
                    "nd": None,
                    "code_secteur": None,
                    "numero_ot": None,
                    "numero_att": None,
                    "oeie": None,
                    "code_gestion_chantier": None,
                    "agence": None,
                    "liste_articles": None,
                    "numero_ppd": None,
                    "attachement_valide": None,
                    "bordereau": None,
                    "ht": None,
                    "n_cac": None,
                    "comment_acqui_rejet": None,
                    "cause_acqui_rejet": None,
                    "imported_at": now,
                    "user_id": current_user.id,
                }
                agg[dossier_key] = rec

            flux = _clean_text(_val(h, "n_de_flux_pidi", "n_flux_pidi", "numero_flux_pidi", "flux_pidi"))
            rec["numero_flux_pidi"] = _pick_first(rec.get("numero_flux_pidi"), flux) or dossier_key

            rec["contrat"] = _pick_first(rec.get("contrat"), _clean_text(_val(h, "contrat")))
            rec["type_pidi"] = _pick_first(
                rec.get("type_pidi"),
                _clean_text(_val(h, "type", "type_pidi", "type_attachement", "type_d_attachement"))
            )
            rec["statut"] = _pick_first(rec.get("statut"), _clean_text(_val(h, "statut", "statut_attachement")))

            rec["nd"] = _pick_first(
                rec.get("nd"),
                _clean_text(_val(h, "nd", "n_d", "ndi", "n_di", "numero_di", "numero_de_di"))
            )
            rec["numero_ot"] = _pick_first(
                rec.get("numero_ot"),
                _clean_text(_val(h, "numero_ot", "n_ot", "ot", "ot_key", "numero_de_l_ot", "numero_intervention"))
            )

            rec["code_secteur"] = _pick_first(rec.get("code_secteur"), _clean_text(_val(h, "code_secteur", "secteur")))
            rec["numero_att"] = _pick_first(
                rec.get("numero_att"),
                _clean_text(_val(h, "numero_att", "n_att", "n_att_", "n_attachement", "numero_attachement"))
            )
            rec["oeie"] = _pick_first(rec.get("oeie"), _clean_text(_val(h, "oeie")))

            rec["code_gestion_chantier"] = _pick_first(
                rec.get("code_gestion_chantier"),
                _clean_text(_val(h, "code_gestion_chantier", "code_gestion", "codes_chantier_de_gestion"))
            )
            rec["agence"] = _pick_first(rec.get("agence"), _clean_text(_val(h, "agence")))

            rec["liste_articles"] = _merge_articles(
                rec.get("liste_articles"),
                _val(h, "liste_des_articles", "liste_articles", "liste_d_articles", "article"),
            )

            rec["numero_ppd"] = _pick_first(
                rec.get("numero_ppd"),
                _clean_text(_val(h, "n_ppd", "numero_ppd", "ppd", "n_pdd", "numero_pdd", "n__ppd"))
            )
            rec["attachement_valide"] = _pick_first(
                rec.get("attachement_valide"),
                _clean_text(_val(h, "attachement_valide", "attachement_validee", "attachement_valide_le", "attachement_valide_at"))
            )

            rec["bordereau"] = _pick_first(rec.get("bordereau"), _clean_text(_val(h, "bordereau")))
            ht_new = _parse_ht(_val(h, "ht", "montant_ht", "prix_majore", "prix", "prix_majoré"))
            rec["ht"] = rec.get("ht") if rec.get("ht") is not None else ht_new

            rec["n_cac"] = _pick_first(
                rec.get("n_cac"),
                _clean_text(_val(h, "n_cac", "numero_cac", "cac", "n_cac_"))
            )
            rec["comment_acqui_rejet"] = _pick_first(
                rec.get("comment_acqui_rejet"),
                _clean_text(_val(h, "comment_acqui_rejet", "commentaire_acqui_rejet", "comment_acqui_rejet_pidi"))
            )
            rec["cause_acqui_rejet"] = _pick_first(
                rec.get("cause_acqui_rejet"),
                _clean_text(_val(h, "cause_acqui_rejet", "cause_acqui_rejet_pidi"))
            )

        # Déduplication finale par vraie clé SQL: (numero_flux_pidi, user_id)
        rows_map: dict[tuple[str, int], dict[str, Any]] = {}
        duplicate_flux_keys: list[str] = []

        for rec in agg.values():
            flux_value = _clean_text(rec.get("numero_flux_pidi"))
            if not flux_value:
                continue

            payload = {
                "numero_flux_pidi": flux_value,
                "user_id": current_user.id,
                "contrat": rec.get("contrat"),
                "type_pidi": rec.get("type_pidi"),
                "statut": rec.get("statut"),
                "nd": rec.get("nd"),
                "code_secteur": rec.get("code_secteur"),
                "numero_ot": rec.get("numero_ot"),
                "numero_att": rec.get("numero_att"),
                "oeie": rec.get("oeie"),
                "code_gestion_chantier": rec.get("code_gestion_chantier"),
                "agence": rec.get("agence"),
                "liste_articles": rec.get("liste_articles"),
                "numero_ppd": rec.get("numero_ppd"),
                "attachement_valide": rec.get("attachement_valide"),
                "bordereau": rec.get("bordereau"),
                "ht": rec.get("ht"),
                "n_cac": rec.get("n_cac"),
                "comment_acqui_rejet": rec.get("comment_acqui_rejet"),
                "cause_acqui_rejet": rec.get("cause_acqui_rejet"),
                "imported_at": now,
            }
            payload = _sa_only_known_columns(RawPidi, payload)

            key = (payload["numero_flux_pidi"], payload["user_id"])
            if key in rows_map:
                duplicate_flux_keys.append(payload["numero_flux_pidi"])

                existing = rows_map[key]
                for field in [
                    "contrat", "type_pidi", "statut", "nd", "code_secteur", "numero_ot",
                    "numero_att", "oeie", "code_gestion_chantier", "agence", "numero_ppd",
                    "attachement_valide", "bordereau", "n_cac",
                    "comment_acqui_rejet", "cause_acqui_rejet"
                ]:
                    existing[field] = _pick_first(existing.get(field), payload.get(field))

                existing["liste_articles"] = _merge_articles(
                    existing.get("liste_articles"),
                    payload.get("liste_articles")
                )

                if existing.get("ht") is None and payload.get("ht") is not None:
                    existing["ht"] = payload.get("ht")

                existing["imported_at"] = now
            else:
                rows_map[key] = payload

        rows_list = list(rows_map.values())

        if not rows_list:
            return {
                "ok": True,
                "rows_in": rows_in,
                "rows_upserted": 0,
                "delimiter_used": eff_delim,
                "duplicate_flux_merged": 0,
            }

        t = RawPidi.__table__

        for chunk in _chunk_list(rows_list, 300):
            stmt = pg_insert(t).values(chunk)
            stmt = stmt.on_conflict_do_update(
                index_elements=[t.c.numero_flux_pidi, t.c.user_id],
                set_={
                    "contrat": stmt.excluded.contrat,
                    "type_pidi": stmt.excluded.type_pidi,
                    "statut": stmt.excluded.statut,
                    "nd": stmt.excluded.nd,
                    "code_secteur": stmt.excluded.code_secteur,
                    "numero_ot": stmt.excluded.numero_ot,
                    "numero_att": stmt.excluded.numero_att,
                    "oeie": stmt.excluded.oeie,
                    "code_gestion_chantier": stmt.excluded.code_gestion_chantier,
                    "agence": stmt.excluded.agence,
                    "liste_articles": stmt.excluded.liste_articles,
                    "numero_ppd": stmt.excluded.numero_ppd,
                    "attachement_valide": stmt.excluded.attachement_valide,
                    "bordereau": stmt.excluded.bordereau,
                    "ht": stmt.excluded.ht,
                    "n_cac": stmt.excluded.n_cac,
                    "comment_acqui_rejet": stmt.excluded.comment_acqui_rejet,
                    "cause_acqui_rejet": stmt.excluded.cause_acqui_rejet,
                    "imported_at": stmt.excluded.imported_at,
                },
            )
            db.execute(stmt)

        db.commit()

        return {
            "ok": True,
            "rows_in": rows_in,
            "rows_upserted": len(rows_list),
            "delimiter_used": eff_delim,
            "duplicate_flux_merged": len(duplicate_flux_keys),
            "duplicate_flux_samples": duplicate_flux_keys[:20],
        }

    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=400,
            detail={
                "error_type": e.__class__.__name__,
                "error": str(e),
            }
        )


@router.post("/praxedo-cr10")
async def import_praxedo_cr10(
    file: UploadFile = File(...),
    delimiter_q: str | None = Query(None),
    delimiter: str = Form(";"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    try:
        d0 = _resolve_delimiter(delimiter_q, delimiter)
        eff_delim = _detect_delimiter(file, d0)

        raw_headers, norm_headers, reader = _read_header_and_reader(file, eff_delim)
        _require_columns_strict(raw_headers, norm_headers, PRAXEDO_CR10_REQUIRED, "PRAXEDO_CR10")

        now = datetime.utcnow()
        by_ot: dict[str, dict[str, Any]] = {}

        for raw_row in reader:
            if not raw_row:
                continue

            h = _normalize_row(raw_row)

            ot_raw = _clean_text(_val(h, "id_externe_ot", "id_externe", "idexterne", "id_externe_"))
            if not ot_raw:
                ot_raw = _clean_text(_find_value_by_header_like(raw_row, "id", "externe"))

            ot = re.sub(r"\s+", "", ot_raw) if ot_raw else None
            if not ot:
                continue

            nd = _clean_text(_val(h, "nom_site", "nom_du_site", "site", "nomsite")) \
                 or _clean_text(_find_value_by_header_like(raw_row, "nom", "site"))

            cr = _clean_text(_val(h, "compte_rendu", "compterendu", "compte_rendu_")) \
                 or _clean_text(_find_value_by_header_like(raw_row, "compte", "rendu"))

            evenements = _clean_text(_val(h, "evenements", "evenement", "events"))
            if not evenements:
                evenements = _clean_text(_find_value_by_header_like(raw_row, "evenement"))

            palier_csv = _clean_text(_val(h, "palier", "pallier", "niveau", "tier"))
            palier = palier_csv or _extract_palier_from_evenements(evenements)

            by_ot[ot] = {
                "id_externe": ot,
                "nom_site": nd,
                "compte_rendu": cr,
                "evenements": evenements,
                "palier": palier,
                "imported_at": now,
                "user_id": current_user.id,
            }

        rows_list = list(by_ot.values())
        if not rows_list:
            raise HTTPException(status_code=400, detail={
                "msg": "Aucune ligne exploitable (OT vide ou illisible).",
                "delimiter_used": eff_delim,
            })

        t = RawPraxedoCr10.__table__
        stmt = pg_insert(t).values(rows_list)

        stmt = stmt.on_conflict_do_update(
            index_elements=[t.c.id_externe, t.c.user_id],
            set_={
                "nom_site": stmt.excluded.nom_site,
                "compte_rendu": stmt.excluded.compte_rendu,
                "evenements": stmt.excluded.evenements,
                "palier": stmt.excluded.palier,
                "imported_at": stmt.excluded.imported_at,
            },
        )

        db.execute(stmt)
        db.commit()

        return {"ok": True, "rows": len(rows_list), "delimiter_used": eff_delim}

    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))