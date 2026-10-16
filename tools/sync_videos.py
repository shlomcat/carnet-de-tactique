#!/usr/bin/env python3
"""Prépare la copie des vidéos du dépôt privé (videos.json) vers la base de la version Claude.

Usage : sync_videos.py <videos.json du dépôt> <dossier de la base exportée> <dossier de sortie>
  - le dossier de la base est celui écrit par la lecture de la collection « videos »
    (un fichier JSON par document, éventuellement dans un sous-dossier videos/) ;
  - écrit dans le dossier de sortie un fichier <doc_id>.json par vidéo nouvelle ou modifiée ;
  - affiche un plan JSON : {"new": [...], "changed": [...], "unchanged": n, "skipped": [...]}.
Une vidéo est « modifiée » quand sa partie ou ses commentaires ont changé (pas les évaluations).
"""
import hashlib, json, os, re, sys

def doc_id(vid):
    return re.sub(r"[^A-Za-z0-9_\-.~:@+]", "_", str(vid))[:180]

def signature(v):
    g = v.get("game") or {}
    core = {"sans": g.get("sans") or [],
            "moments": [[m.get("sec"), m.get("ref"), m.get("comment"), m.get("fen")] for m in v.get("moments") or []]}
    return hashlib.sha1(json.dumps(core, sort_keys=True, ensure_ascii=False).encode()).hexdigest()

def load_db(d):
    out = {}
    if not os.path.isdir(d):
        return out
    for root, _, files in os.walk(d):
        for f in files:
            if not f.endswith(".json"):
                continue
            try:
                j = json.load(open(os.path.join(root, f), encoding="utf-8"))
            except Exception:
                continue
            doc = j if isinstance(j, dict) and "moments" in j else (j.get("data") if isinstance(j, dict) else None)
            if isinstance(doc, dict) and doc.get("id"):
                out[doc_id(doc["id"])] = doc
    return out

def main(src, dbdir, outdir):
    os.makedirs(outdir, exist_ok=True)
    data = json.load(open(src, encoding="utf-8"))
    videos = data.get("videos", []) if isinstance(data, dict) else data
    db = load_db(dbdir)
    plan = {"new": [], "changed": [], "unchanged": 0, "skipped": []}
    for v in videos:
        if not isinstance(v, dict) or not v.get("id") or not isinstance(v.get("moments"), list):
            continue
        v = {k: val for k, val in v.items() if k != "remote"}
        did = doc_id(v["id"])
        body = json.dumps(v, ensure_ascii=False)
        if len(body.encode()) > 250000:
            plan["skipped"].append({"doc_id": did, "reason": "trop volumineuse"})
            continue
        if did in db and signature(db[did]) == signature(v):
            plan["unchanged"] += 1
            continue
        with open(os.path.join(outdir, did + ".json"), "w", encoding="utf-8") as fh:
            fh.write(body)
        plan["changed" if did in db else "new"].append(did)
    print(json.dumps(plan, ensure_ascii=False))

if __name__ == "__main__":
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    main(*sys.argv[1:])
