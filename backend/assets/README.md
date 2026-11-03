# Ressources embarquées dans les PDF Factur-X

PDF/A-3 exige que les polices soient incorporées et qu'un profil colorimétrique (OutputIntent) soit déclaré.

| Fichier | Origine | Licence |
|---|---|---|
| `fonts/DejaVuSans.ttf`, `fonts/DejaVuSans-Bold.ttf` | DejaVu Fonts 2.37 | Bitstream Vera / domaine public (voir `fonts/LICENSE-DejaVu.txt`) — redistribution libre |
| `icc/sRGB-lcms.icc` | profil sRGB généré par Little CMS (`ImageCms.createProfile("sRGB")`) | aucune restriction (profil calculé) |

Les polices sont incorporées en sous-ensemble : seuls les glyphes utilisés entrent dans le PDF.
