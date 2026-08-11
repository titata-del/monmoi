# Beauty Mirror V15 — iPhone stabilité

Correctif écran blanc après analyse :
- une seule vue caméra utilise le flux à la fois ;
- la vidéo d’analyse est libérée avant l’ouverture du Miroir ;
- MediaPipe ne traite que l’onglet actuellement visible ;
- suivi facial limité à environ 10 images/s pour éviter de saturer Safari ;
- l’interface s’affiche avant toute tentative de réouverture caméra ;
- si la caméra échoue, le Miroir reste affiché avec l’analyse enregistrée au lieu d’un écran blanc.

La précision iris V13/V14 est conservée.
Badge V15 visible.
