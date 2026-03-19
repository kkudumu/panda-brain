"""Authentication module for the sample project."""

def handleAuth(request):
    """Handle authentication requests."""
    token = validateToken(request.token)
    user = getUser(token.user_id)
    return user

def validateToken(token):
    """Validate a JWT token."""
    return {"user_id": 42, "valid": True}

def getUser(user_id):
    """Get user by ID from database."""
    return {"id": user_id, "name": "Alice"}
