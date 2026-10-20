# Site de téléchargement : afficher le code promo du commercial

Chaque commercial AZƆ̀ a un **lien personnel** de la forme

```
https://azo.angidsnpro.com/?ref=COM-AZO001#telecharger
```

Le serveur le fabrique tout seul (variable `REFERRAL_LINK_BASE` si l'adresse du site change). Le commercial le voit dans son espace (onglet « Mon lien ») et l'administrateur dans la fiche du commercial ; les deux peuvent le partager par WhatsApp, SMS, etc.

**Ce que fait le lien aujourd'hui :** il ouvre la page de téléchargement. L'application est téléchargée depuis Google Drive (fichier APK) : **le code ne peut pas voyager dans le fichier**. Il faut donc que la page l'affiche et que le futur Speeder, livreur, coursier ou agence le saisisse dans le champ « Code promo du commercial (facultatif) » de l'inscription.

La page du site n'est pas dans le dépôt de l'application : le petit script ci-dessous est à ajouter **une seule fois** dans la page `https://azo.angidsnpro.com/`, juste avant la balise `</body>`. Il :

- lit le code dans l'adresse (`?ref=COM-AZO001`) et le garde pour la suite de la visite ;
- affiche un bandeau « Ton code promo : COM-AZO001 — saisis-le à l'inscription » ;
- copie le code dans le presse-papiers quand on touche « Télécharger l'application ».

```html
<!-- AZƆ̀ : code promo du commercial (à coller juste avant </body>) -->
<div id="azo-promo" style="display:none;position:fixed;left:12px;right:12px;bottom:12px;z-index:9999;background:#7100af;color:#fff;border-radius:16px;padding:14px 16px;font-family:system-ui,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.25);text-align:center"></div>
<script>
(function () {
  var VALID = /^COM-AZO\d{3,6}$/;
  var m = /[?&]ref=([^&#]+)/.exec(location.search);
  var code = m ? decodeURIComponent(m[1]).toUpperCase().replace(/[^A-Z0-9-]/g, "") : "";
  try {
    if (!VALID.test(code)) code = localStorage.getItem("azoPromo") || "";
    if (VALID.test(code)) localStorage.setItem("azoPromo", code);
  } catch (e) {}
  if (!VALID.test(code)) return;
  var box = document.getElementById("azo-promo");
  box.innerHTML = "Ton code promo : <b style=\"letter-spacing:1px\">" + code + "</b><br><small>Saisis-le à l'inscription dans l'application AZƆ̀.</small>";
  box.style.display = "block";
  var links = document.querySelectorAll('a[href*="drive.google.com"]');
  for (var i = 0; i < links.length; i++) {
    links[i].addEventListener("click", function () {
      try { navigator.clipboard.writeText(code); } catch (e) {}
      box.innerHTML = "Code <b>" + code + "</b> copié. Colle-le (ou saisis-le) à l'inscription dans l'application.";
    });
  }
})();
</script>
```

## Aller plus loin (plus tard)

Pour que le code soit **rempli automatiquement** dans l'application, il faudrait lire le presse-papiers à l'ouverture de l'inscription (module `expo-clipboard`, à ajouter à l'application) ou publier l'application sur Google Play (le code voyage alors dans le lien d'installation). Rien n'est fait pour l'instant.
