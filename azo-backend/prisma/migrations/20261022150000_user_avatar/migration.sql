-- Photo de profil conservée sur le serveur (table à part, supprimée avec le compte)
CREATE TABLE "UserAvatar" (
    "userId" TEXT NOT NULL,
    "dataUri" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserAvatar_pkey" PRIMARY KEY ("userId")
);

ALTER TABLE "UserAvatar" ADD CONSTRAINT "UserAvatar_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
