CREATE TABLE IF NOT EXISTS referentiels.regle_facturation_ftth (
    id bigserial PRIMARY KEY,
    code_activite text NOT NULL,
    code_produit text NOT NULL,

    palier_1_codes text[] NULL,
    palier_2_codes text[] NULL,

    article_passage_1 text NULL,
    article_passage_2 text NULL,

    plp_standard_article text NULL,
    f03_article text NULL,
    f04_article text NULL,

    add_pser1 boolean NOT NULL DEFAULT false,
    iq_requires_cvd_for_pser1 boolean NOT NULL DEFAULT false,
    add_etcfo_after_prv boolean NOT NULL DEFAULT false,

    is_active boolean NOT NULL DEFAULT true
);

TRUNCATE TABLE referentiels.regle_facturation_ftth;

INSERT INTO referentiels.regle_facturation_ftth (
    code_activite,
    code_produit,
    palier_1_codes,
    palier_2_codes,
    article_passage_1,
    article_passage_2,
    plp_standard_article,
    f03_article,
    f04_article,
    add_pser1,
    iq_requires_cvd_for_pser1,
    add_etcfo_after_prv,
    is_active
)
SELECT
    r.code_activite,
    r.code_produit,
    ARRAY['ANC','ABS','ANN','RMC','RRC','TVC','REO','PBC','PAD','TSO']::text[],
    ARRAY['RMF','MC']::text[],
    NULL,
    NULL,
    'PLPC1',
    'PLPS',
    'PLPM1',
    CASE
        WHEN upper(r.code_activite) IN ('LMD','LMV','MIT','IDV','LM','IH','IR','IT','ONT','IQ')
        THEN true
        ELSE false
    END,
    CASE
        WHEN upper(r.code_activite) = 'IQ' THEN true
        ELSE false
    END,
    CASE
        WHEN upper(r.code_activite) = 'PRV' THEN false
        ELSE true
    END,
    true
FROM referentiels.regle_facturation r
WHERE r.is_active = true;