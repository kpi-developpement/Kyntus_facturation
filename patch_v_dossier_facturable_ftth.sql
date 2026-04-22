CREATE OR REPLACE VIEW canonique.v_dossier_facturable AS
WITH src AS (
    SELECT
        c.user_id,
        c.key_match,
        c.ot_key,
        c.nd_global,
        c.statut_croisement,
        c.praxedo_ot_key,
        c.praxedo_nd,
        c.activite_code,
        c.produit_code,
        c.code_cloture_code,
        c.statut_praxedo,
        c.date_planifiee,
        c.date_cloture,
        c.technicien,
        c.commentaire_praxedo,
        c.statut_pidi,
        c.code_cible,
        c.pidi_date_creation,
        c.numero_att,
        c.liste_articles,
        c.liste_articles_canon,
        c.commentaire_pidi,
        c.generated_at,
        c.desc_site,
        c.description,
        c.type_site_terrain,
        c.type_pbo_terrain,
        c.mode_passage,
        c.article_facturation_propose,
        c.statut_article,
        c.numero_ppd,
        c.attachement_valide,
        c.commentaire_technicien,
        COALESCE(c.commentaire_technicien, cr10.compte_rendu, c.compte_rendu, c.commentaire_praxedo) AS compte_rendu,
        cr10.evenements,
        upper(COALESCE(c.commentaire_technicien, cr10.compte_rendu, c.compte_rendu, c.commentaire_praxedo, '')) AS cmt,
        CASE
            WHEN lower(COALESCE(c.commentaire_technicien, cr10.compte_rendu, c.compte_rendu, c.commentaire_praxedo, '')) LIKE '%reprise plp%' THEN 'Reprise PLP mentionnée'
            WHEN lower(COALESCE(c.commentaire_technicien, cr10.compte_rendu, c.compte_rendu, c.commentaire_praxedo, '')) LIKE '%pto existant%' THEN 'PTO existant mentionné'
            WHEN lower(COALESCE(c.commentaire_technicien, cr10.compte_rendu, c.compte_rendu, c.commentaire_praxedo, '')) LIKE '%prise existante%' THEN 'Prise existante mentionnée'
            WHEN lower(COALESCE(c.commentaire_technicien, cr10.compte_rendu, c.compte_rendu, c.commentaire_praxedo, '')) LIKE '%travaux supplémentaires%' THEN 'Travaux supplémentaires avec décharge'
            WHEN lower(COALESCE(c.commentaire_technicien, cr10.compte_rendu, c.compte_rendu, c.commentaire_praxedo, '')) LIKE '%plp%' THEN 'PLP détecté dans commentaire technicien'
            ELSE NULL
        END AS phrase_declencheuse,
        replace(COALESCE(cr10.evenements, ''), chr(160), ' ') AS evenements_norm,
        CASE
            WHEN replace(COALESCE(cr10.evenements, ''), chr(160), ' ') ~* 'pididegr'
                 AND replace(COALESCE(cr10.evenements, ''), chr(160), ' ') ~* 'palier[[:space:]]*2'
                THEN 'PALIER_2'
            WHEN replace(COALESCE(cr10.evenements, ''), chr(160), ' ') ~* 'pididegr'
                 AND replace(COALESCE(cr10.evenements, ''), chr(160), ' ') ~* 'palier[[:space:]]*1'
                THEN 'PALIER_1'
            WHEN replace(COALESCE(cr10.evenements, ''), chr(160), ' ') ~* 'pididegr'
                 AND replace(COALESCE(cr10.evenements, ''), chr(160), ' ') ~* 'aucun(e|es)?[[:space:]]+regle'
                THEN 'PALIER_1'
            ELSE NULL
        END AS palier,
        CASE
            WHEN btrim(replace(COALESCE(cr10.evenements, ''), chr(160), ' ')) = '' THEN NULL
            WHEN replace(COALESCE(cr10.evenements, ''), chr(160), ' ') !~* 'pididegr' THEN NULL
            ELSE NULLIF((regexp_match(
                replace(COALESCE(cr10.evenements, ''), chr(160), ' '),
                '(?i)pididegr[^=]*=[^=]*=system=([^#\r\n]+)'
            ))[1], '')
        END AS palier_phrase
    FROM canonique.v_croisement c
    LEFT JOIN raw.praxedo_cr10 cr10
        ON ltrim(regexp_replace(btrim(cr10.id_externe), '[^0-9]', '', 'g'), '0')
         = ltrim(regexp_replace(btrim(c.ot_key), '[^0-9]', '', 'g'), '0')
       AND cr10.user_id = c.user_id
),
flags AS (
    SELECT
        s.*,
        s.cmt ~ '(PLP|REPRISE\s*PLP|PTO\s*EXISTANT|PRISE\s*EXISTANTE)' AS force_plp,
        s.cmt ~ '(IMMEUBLE|INTERIEUR|FAUX\s*PLAFOND)' AS kw_immeuble,
        s.cmt ~ '(SOUTERRAIN|FOURREAU)' AS kw_souterrain,
        s.cmt ~ '(FACADE|AERIEN|APPARENT|GOULOTTE)' AS kw_facade_aerien,
        s.cmt ~ '(TRAVAUX\s*SUPPLEMENTAIRES\s*AVEC\s*DECHARGE)' AS add_tsfh,
        (
            (
                upper(COALESCE(s.activite_code, '')) = ANY (ARRAY['LML','LMP','LMS'])
                OR upper(COALESCE(s.activite_code, '')) = 'LMC'
            )
            AND s.cmt ~ '(PLP|REPRISE\s*PLP|PTO\s*EXISTANT|PRISE\s*EXISTANTE)'
        ) AS add_pesr
    FROM src s
),
override_articles AS (
    SELECT
        f.*,
        CASE
            WHEN f.kw_souterrain THEN 'LSOU1, LSOUP'
            WHEN f.kw_facade_aerien THEN 'LSA1, LSAFP'
            WHEN f.kw_immeuble THEN 'LSIM1, LSIMP'
            ELSE NULL
        END AS forced_articles,
        canonique.merge_articles(
            CASE WHEN f.add_tsfh THEN 'TSFH' ELSE NULL END,
            CASE WHEN f.add_pesr THEN 'PESR' ELSE NULL END
        ) AS extra_articles,
        CASE
            WHEN f.force_plp THEN 'COMMENTAIRE_PLP'
            WHEN f.kw_souterrain OR f.kw_facade_aerien OR f.kw_immeuble THEN 'COMMENTAIRE_MODE'
            WHEN f.article_facturation_propose IS NOT NULL THEN 'TERRAIN'
            ELSE 'AUCUNE'
        END AS source_facturation
    FROM flags f
)
SELECT
    o.user_id,
    o.key_match,
    o.ot_key,
    o.nd_global,
    o.statut_croisement,
    o.praxedo_ot_key,
    o.praxedo_nd,
    o.activite_code,
    o.produit_code,
    o.code_cloture_code,
    o.statut_praxedo,
    o.date_planifiee,
    o.date_cloture,
    o.technicien,
    o.commentaire_praxedo,
    o.statut_pidi,
    o.code_cible,
    o.pidi_date_creation,
    o.numero_att,
    o.liste_articles,
    o.commentaire_pidi,
    r.code AS regle_code,
    r.libelle AS libelle_regle,
    r.condition_sql,
    r.condition_json,
    r.statut_facturation,
    r.codes_cloture_facturables,
    r.type_branchement,
    r.plp_applicable,
    r.services,
    r.prix_degressifs,
    r.articles_optionnels,
    r.documents_attendus,
    r.pieces_facturation,
    r.outils_depose,
    r.justificatifs,
    r.code_chantier_generique,
    r.categorie,
    o.activite_code = 'PRV' AS is_previsite,
    CASE
        WHEN o.activite_code = 'PRV' THEN 'PREVISITE'
        WHEN o.statut_croisement <> 'OK' THEN 'CROISEMENT_INCOMPLET'
        WHEN o.activite_code IS NULL OR o.produit_code IS NULL THEN 'ACTPROD_MANQUANT'
        WHEN r.id IS NULL THEN 'REGLE_MANQUANTE'
        WHEN r.statut_facturation = 'NON_FACTURABLE' THEN 'NON_FACTURABLE_REGLE'
        WHEN r.codes_cloture_facturables IS NOT NULL
             AND (o.code_cloture_code IS NULL OR NOT (o.code_cloture_code = ANY (r.codes_cloture_facturables)))
            THEN 'CLOTURE_INVALIDE'
        ELSE NULL
    END AS motif_verification,
    CASE
        WHEN o.activite_code = 'PRV' THEN 'NON_FACTURABLE'
        WHEN o.statut_croisement <> 'OK' THEN 'A_VERIFIER'
        WHEN o.activite_code IS NULL OR o.produit_code IS NULL THEN 'A_VERIFIER'
        WHEN r.id IS NULL THEN 'A_VERIFIER'
        WHEN r.statut_facturation = 'NON_FACTURABLE' THEN 'NON_FACTURABLE'
        WHEN r.codes_cloture_facturables IS NOT NULL
             AND (o.code_cloture_code IS NULL OR NOT (o.code_cloture_code = ANY (r.codes_cloture_facturables)))
            THEN 'A_VERIFIER'
        WHEN r.statut_facturation = 'CONDITIONNEL' THEN 'CONDITIONNEL'
        ELSE 'FACTURABLE'
    END AS statut_final,
    CASE
        WHEN r.codes_cloture_facturables IS NULL THEN NULL::boolean
        WHEN o.code_cloture_code IS NULL THEN false
        ELSE o.code_cloture_code = ANY (r.codes_cloture_facturables)
    END AS cloture_facturable,
    o.generated_at,
    o.desc_site,
    o.description,
    o.type_site_terrain,
    o.type_pbo_terrain,
    o.mode_passage,
    canonique.merge_articles(
        canonique.merge_articles(
            CASE
                WHEN upper(COALESCE(o.activite_code, '')) = 'F03' THEN COALESCE(rf.f03_article, 'PLPS')
                WHEN upper(COALESCE(o.activite_code, '')) = 'F04' THEN COALESCE(rf.f04_article, 'PLPM1')
                WHEN o.force_plp THEN COALESCE(rf.plp_standard_article, 'PLPC1')
                ELSE COALESCE(o.forced_articles, o.article_facturation_propose)
            END,
            CASE
                WHEN upper(COALESCE(o.activite_code, '')) IN ('LMD','LMV','MIT','IDV','LM','IH','IR','IT','ONT') THEN 'PSER1'
                WHEN upper(COALESCE(o.activite_code, '')) = 'IQ'
                     AND upper(COALESCE(o.description, '') || ' ' || COALESCE(o.compte_rendu, '') || ' ' || COALESCE(o.commentaire_technicien, '')) LIKE '%CVD%'
                    THEN 'PSER1'
                ELSE NULL
            END
        ),
        o.extra_articles
    ) AS article_facturation_propose,
    o.statut_article,
    o.numero_ppd,
    o.attachement_valide,
    o.force_plp,
    o.add_tsfh,
    o.commentaire_technicien,
    o.source_facturation,
    o.compte_rendu,
    o.phrase_declencheuse,
    o.evenements,
    CASE
    WHEN o.code_cloture_code = ANY (ARRAY['ANC','ABS','ANN','RMC','RRC','TVC','REO','PBC','PAD','TSO']) THEN 'PALIER_1'
    WHEN o.code_cloture_code = ANY (ARRAY['RMF','MC']) THEN 'PALIER_2'
    ELSE NULL
END AS palier,
    o.palier_phrase
FROM override_articles o
LEFT JOIN referentiels.regle_facturation_ftth rf
    ON upper(btrim(rf.code_activite)) = upper(btrim(o.activite_code))
   AND upper(btrim(rf.code_produit)) = upper(btrim(o.produit_code))
   AND rf.is_active = true
LEFT JOIN LATERAL (
    SELECT
        r1.id,
        r1.code,
        r1.libelle,
        r1.condition_sql,
        r1.statut_facturation,
        r1.codes_cloture_facturables,
        r1.type_branchement,
        r1.plp_applicable,
        r1.services,
        r1.prix_degressifs,
        r1.articles_optionnels,
        r1.documents_attendus,
        r1.pieces_facturation,
        r1.outils_depose,
        r1.justificatifs,
        r1.code_chantier_generique,
        r1.categorie,
        r1.condition_json
    FROM referentiels.regle_facturation r1
    WHERE r1.is_active = true
      AND upper(btrim(r1.code_activite)) = upper(btrim(o.activite_code))
      AND upper(btrim(r1.code_produit)) = upper(btrim(o.produit_code))
    ORDER BY
        CASE
            WHEN r1.codes_cloture_facturables IS NOT NULL
             AND o.code_cloture_code IS NOT NULL
             AND (o.code_cloture_code = ANY (r1.codes_cloture_facturables))
            THEN 0
            ELSE 1
        END,
        r1.updated_at DESC NULLS LAST,
        r1.id DESC
    LIMIT 1
) r ON true
WHERE o.key_match IS NOT NULL
  AND o.key_match <> '';