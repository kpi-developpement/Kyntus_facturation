#Backend/models/raw_praxedo.py
from sqlalchemy import Column, Text, TIMESTAMP, Integer, ForeignKey
from database.connection import Base


class RawPraxedo(Base):
    __tablename__ = "praxedo"
    __table_args__ = {"schema": "raw"}

    numero = Column(Text, primary_key=True)
    user_id = Column(Integer, ForeignKey("public.users.id"), primary_key=True)

    statut = Column(Text)
    planifiee = Column(Text)
    nom_technicien = Column(Text)
    prenom_technicien = Column(Text)
    equipiers = Column(Text)
    nd = Column(Text)
    act_prod = Column(Text)
    code_intervenant = Column(Text)
    cp = Column(Text)
    ville_site = Column(Text)

    desc_site = Column(Text)
    description = Column(Text)
    compte_rendu = Column(Text)
    csv_extra = Column(Text)
    autre = Column(Text)
    imported_at = Column(TIMESTAMP)