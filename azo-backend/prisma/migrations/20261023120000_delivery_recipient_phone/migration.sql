-- Livraison express : numéro du destinataire, à qui le code de remise est destiné
ALTER TABLE "Delivery" ADD COLUMN "recipientPhone" TEXT;
