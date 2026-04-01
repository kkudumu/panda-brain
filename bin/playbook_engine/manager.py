"""PlaybookManager - CRUD and matching for playbooks."""

import json
import os
from typing import List, Optional

from .models import Playbook


class PlaybookManager:
    """Manages approved and draft playbooks on disk as JSON files."""

    def __init__(self, playbooks_dir: str):
        self.playbooks_dir = playbooks_dir
        self.approved_dir = playbooks_dir  # approved live at root
        self.drafts_dir = os.path.join(playbooks_dir, "drafts")
        self.archive_dir = os.path.join(playbooks_dir, "archive")
        os.makedirs(self.approved_dir, exist_ok=True)
        os.makedirs(self.drafts_dir, exist_ok=True)
        os.makedirs(self.archive_dir, exist_ok=True)

    # --- Read ---

    def _load_from_dir(self, directory: str) -> List[Playbook]:
        playbooks = []
        for f in sorted(os.listdir(directory)):
            if not f.endswith(".json"):
                continue
            path = os.path.join(directory, f)
            try:
                with open(path) as fh:
                    playbooks.append(Playbook.from_dict(json.load(fh)))
            except (json.JSONDecodeError, KeyError):
                continue
        return playbooks

    def list_playbooks(self) -> List[Playbook]:
        return self._load_from_dir(self.approved_dir)

    def list_drafts(self) -> List[Playbook]:
        return self._load_from_dir(self.drafts_dir)

    def get(self, playbook_id: str) -> Optional[Playbook]:
        for pb in self.list_playbooks():
            if pb.id == playbook_id:
                return pb
        return None

    def get_draft(self, playbook_id: str) -> Optional[Playbook]:
        for pb in self.list_drafts():
            if pb.id == playbook_id:
                return pb
        return None

    # --- Write ---

    def _save(self, pb: Playbook, directory: str) -> str:
        path = os.path.join(directory, f"{pb.id}.json")
        with open(path, "w") as fh:
            json.dump(pb.to_dict(), fh, indent=2)
        return path

    def save_playbook(self, pb: Playbook) -> str:
        return self._save(pb, self.approved_dir)

    def save_draft(self, pb: Playbook) -> str:
        return self._save(pb, self.drafts_dir)

    def promote_draft(self, playbook_id: str) -> Optional[Playbook]:
        pb = self.get_draft(playbook_id)
        if not pb:
            return None
        # Move from drafts to approved
        draft_path = os.path.join(self.drafts_dir, f"{pb.id}.json")
        self.save_playbook(pb)
        if os.path.exists(draft_path):
            os.remove(draft_path)
        return pb

    def delete_draft(self, playbook_id: str) -> bool:
        path = os.path.join(self.drafts_dir, f"{playbook_id}.json")
        if os.path.exists(path):
            os.remove(path)
            return True
        return False

    # --- Matching ---

    def match_ticket(self, ticket_type: str = "", text: str = "", source: str = "") -> List[Playbook]:
        """Find playbooks whose trigger_keywords match the given text."""
        text_lower = text.lower()
        matches = []
        for pb in self.list_playbooks():
            score = 0
            for kw in pb.trigger_keywords:
                if kw.lower() in text_lower:
                    score += 1
            if score > 0:
                # Temporarily set confidence based on keyword hit ratio
                pb.confidence = round(score / max(len(pb.trigger_keywords), 1), 2)
                matches.append(pb)
        return sorted(matches, key=lambda p: p.confidence, reverse=True)
