#!/usr/bin/env bash
# Lanza N procesos en la misma GPU, cada uno con su shard, y al final reconstruye index.json.
# Uso:  nohup ./run_parallel.sh 3 > launcher.log 2>&1 &
#       ./run_parallel.sh 3 --skip-llm      (los argumentos extra se pasan a todos los procesos)
# Requiere haber cargado las variables:  set -a; source covid.env; set +a
set -u
N=${1:-3}; shift || true
cd "$(dirname "$0")"
pids=()
for ((i=0; i<N; i++)); do
  python process_dataset.py --all --shard "$i/$N" --no-index --post-workers 1 "$@" > "shard$i.log" 2>&1 &
  pids+=($!)
  sleep 5      # escalona el arranque para no saturar CPU/disco cargando modelos a la vez
done
echo "Lanzados $N procesos: ${pids[*]}"
wait "${pids[@]}"
echo "Todos terminaron. Reconstruyendo index.json..."
python process_dataset.py --build-index
