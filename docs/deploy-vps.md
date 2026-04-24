# Déploiement VPS — Mémoire des Cévennes

Note : ce guide suppose un VPS Linux avec accès root (Debian 12 / Ubuntu
22.04+). Prestataires adaptés : OVH, Hetzner, Scaleway — tous proposent des
offres < 10 €/mois adaptées à la charge anticipée.

## Prérequis

- Nom de domaine pointant vers le VPS (enregistrement DNS A/AAAA).
- Accès SSH root ou sudo.

## 1. Base système

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git curl ufw
# Node 20 LTS via NodeSource
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt install -y nodejs
```

Pare-feu minimal :

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

## 2. Utilisateur dédié

Ne pas faire tourner le service en root.

```bash
sudo useradd -m -s /bin/bash memoire
sudo -u memoire -i
```

## 3. Clone + dépendances

```bash
cd ~
git clone git@github.com:Poisson48/Memoire_des_Cevennes.git
cd Memoire_des_Cevennes
npm ci --production

cp .env.example .env
# Édite .env :
#  - JWT_SECRET : node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
#  - ADMIN_TOKEN : openssl rand -base64 24
#  - COOKIE_SECURE=true   (obligatoire en prod HTTPS)
#  - PORT=3003
```

Premier admin :

```bash
SEED_EMAIL=ton@email.fr SEED_NAME="Ton Nom" SEED_PASSWORD="un mot de passe fort" \
  node scripts/seed-admin.js
```

## 4. Service systemd

Comme utilisateur root :

```bash
sudo tee /etc/systemd/system/memoire.service >/dev/null <<'EOF'
[Unit]
Description=Mémoire des Cévennes
After=network.target

[Service]
Type=simple
User=memoire
WorkingDirectory=/home/memoire/Memoire_des_Cevennes
EnvironmentFile=/home/memoire/Memoire_des_Cevennes/.env
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
ProtectSystem=full
ProtectHome=read-only
ReadWritePaths=/home/memoire/Memoire_des_Cevennes/data /home/memoire/Memoire_des_Cevennes/uploads

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now memoire
sudo systemctl status memoire
```

## 5. Reverse proxy + HTTPS (Caddy)

Caddy fait le certificat Let's Encrypt automatiquement — le plus simple.

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
```

`/etc/caddy/Caddyfile` :

```
memoiredescevennes.fr, www.memoiredescevennes.fr {
    encode gzip
    reverse_proxy localhost:3003

    # Sécurité : headers standards
    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        X-Content-Type-Options    "nosniff"
        Referrer-Policy           "strict-origin-when-cross-origin"
        Permissions-Policy        "geolocation=(self), microphone=(self), camera=(self)"
    }
}
```

```bash
sudo systemctl reload caddy
```

Caddy demande et renouvelle le certificat Let's Encrypt tout seul. Vérifie :

```bash
curl -I https://memoiredescevennes.fr
# → HTTP/2 200 + en-tête HSTS visible
```

## 6. Sauvegardes

Active le cron hebdomadaire des sauvegardes :

```bash
# Comme utilisateur memoire :
crontab -e
# Ajoute :
0 3 * * 1  /home/memoire/Memoire_des_Cevennes/scripts/backup.sh >> /home/memoire/backup.log 2>&1
```

Les archives atterrissent dans `~/backups/memoire-cevennes/`. Pense à les
copier hors du VPS (rsync vers un disque perso, ou service cloud) au moins
une fois par mois.

## 7. Mises à jour

```bash
cd ~/Memoire_des_Cevennes
git pull
npm ci --production
sudo systemctl restart memoire
```

## 8. Check de santé périodique

```bash
sudo systemctl status memoire       # service actif ?
tail -n 50 /var/log/caddy/access.log # Caddy reçoit du trafic ?
df -h ~/backups/                    # espace sauvegarde ok ?
```

## 9. Plan de reprise (incident)

1. Couper le service : `sudo systemctl stop memoire`
2. Restaurer la dernière sauvegarde : `tar xzf ~/backups/memoire-cevennes/xxx.tar.gz -C ~/Memoire_des_Cevennes/`
3. Vérifier les permissions : `chown -R memoire:memoire data uploads`
4. Redémarrer : `sudo systemctl start memoire`
5. Documenter l'incident dans le registre de l'association.
