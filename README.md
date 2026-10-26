-- Folder structure 

HR-MANAGEMENT-DOCKER/
├── docker-compose.yml
├── .env
├── backend/
│   ├── Dockerfile
│   ├── .dockerignore
│   ├── package.json
│   └── server.js
└── frontend/
    ├── Dockerfile
    ├── nginx.conf
    ├── index.html
    ├── style.css
    └── app.js


-- for run docker-compose.yml file

docker compose up -d --build
docker compose ps


# http://192.168.0.125:8080/


# Work follow 


1. The goal and the design


Browser  →  frontend (nginx, Docker)  →  backend (Node.js, Docker)  →  Oracle VM
            http://192.168.0.125:8080       port 3000 (internal)         192.168.0.205:1524



2. Preparing the Oracle VM


export ORACLE_SID=dblcluster
sqlplus / as sysdba



STARTUP;


ALTER SYSTEM SET LOCAL_LISTENER='(ADDRESS=(PROTOCOL=TCP)(HOST=192.168.0.205)(PORT=1524))' SCOPE=BOTH;
ALTER SYSTEM REGISTER;
ALTER USER hr ACCOUNT UNLOCK;
EXIT;


--Open the firewall (needs root, not the oracle user)

lsnrctl start lvm1524      # skip if it is already running
lsnrctl status lvm1524

-- test from windows command line
Test-NetConnection 192.168.0.205 -Port 1524s


3. Creating the project

HR-MANAGEMENT-DOCKER/
├── docker-compose.yml
├── .env
├── backend/   Dockerfile, .dockerignore, package.json, server.js
└── frontend/  Dockerfile, nginx.conf, index.html, style.css, app.js



# File	                        #What it does
.env	                        Stores the DB user (hr), password, and connect string 192.168.0.205:1524/dblcluster

docker-compose.yml	            Starts both containers with one command and passes the .env values to the backend

backend/Dockerfile	            Builds a Node.js image and installs express and oracledb

backend/server.js	            The API. It logs in to Oracle as hr, runs SQL, and returns JSON

frontend/Dockerfile	            Builds an nginx image holding your HTML, CSS and JS

frontend/nginx.conf	            Serves the page and forwards every /api/ request to the backend

index.html, style.css, app.js	The page, its look, and the code that calls the API


4. Deploying

docker compose up -d --build
docker compose ps

# You then tested /api/health and /api/regions and opened http://192.168.0.125:8080.


7. Everyday use 

Start everything after a VM reboot (on the VM):

export ORACLE_SID=dblcluster
sqlplus / as sysdba
SQL> startup
SQL> ALTER SYSTEM REGISTER;
SQL> EXIT
lsnrctl start lvm1524
lsnrctl status lvm1524

#
docker compose up -d          # start
docker compose down           # stop
docker compose up -d --build  # after changing code
docker compose logs backend   # when something fails

##

# HR Management (Docker)

A web application to view, search, add and edit employees stored in an
existing **Oracle HR schema**.

- **Frontend:** HTML, CSS, JavaScript served by nginx
- **Backend:** Node.js (Express) with the `oracledb` driver
- **Database:** Oracle (external server or VM, not part of this repo)

```
Browser -> frontend (nginx :8080) -> backend (Node.js :3000) -> Oracle DB
```

## Features

- Paginated employee report (5, 10, 25 or 50 rows per page)
- Search by name or email
- Add new employee (job and department dropdowns)
- Edit existing employee

## Requirements

- Docker and Docker Compose
- An Oracle database with the HR sample schema
  (tables: `employees`, `departments`, `jobs`, `regions`)
- Network access from the Docker host to the database listener port
- An Oracle user (for example `hr`) that is unlocked and owns or can access the HR tables

## Quick start

```bash
git clone https://github.com/<your-username>/HR-MANAGEMENT-DOCKER.git
cd HR-MANAGEMENT-DOCKER

cp .env.example .env        # Windows PowerShell: copy .env.example .env
# edit .env with your real database settings

docker compose up -d --build
docker compose ps
```

Open: **http://localhost:8080** (or `http://<server-ip>:8080`)

## Configuration (`.env`)

| Variable | Description | Example |
|---|---|---|
| `DB_USER` | Oracle user | `hr` |
| `DB_PASSWORD` | Password for that user | `change_me` |
| `DB_CONNECT_STRING` | `host:port/service_name` | `192.168.0.205:1524/dblcluster` |

Never commit `.env`. It is listed in `.gitignore`.

## Useful commands

```bash
docker compose up -d --build     # build and start
docker compose down              # stop
docker compose logs -f backend   # backend logs
docker compose ps                # container status
```

## Update to a new version

```bash
git pull
docker compose up -d --build
```

## API

| Method | URL | Purpose |
|---|---|---|
| GET | `/api/health` | Health check |
| GET | `/api/employees?page=1&pageSize=10&search=` | Paginated list |
| GET | `/api/employees/:id` | One employee |
| POST | `/api/employees` | Add employee |
| PUT | `/api/employees/:id` | Update employee |
| GET | `/api/jobs` | Job list |
| GET | `/api/departments` | Department list |
| GET | `/api/regions` | Region list |

## Troubleshooting

| Problem | Likely cause and fix |
|---|---|
| "Failed to load data" | Database or listener is down. Run `docker compose logs backend` |
| `ORA-12541: no listener` | Start the listener on the database server |
| `ORA-12514: service not known` | Wrong service name in `DB_CONNECT_STRING` |
| `ORA-01017: invalid username/password` | Wrong `DB_USER` or `DB_PASSWORD`, or the account is locked |
| Timeout | Firewall blocks the listener port, or the host cannot reach the DB |
| Port 8080 already in use | Change `"8080:80"` in `docker-compose.yml` |
| Page looks old after update | Rebuild with `--build` and hard refresh (Ctrl+F5) |

## Production notes

- Use a strong database password and a dedicated limited user, never `SYS`.
- Expose only the web port publicly. Do not expose the backend (3000) or database port.
- Put HTTPS in front (for example Caddy or nginx with Let's Encrypt).
- Back up the database regularly.