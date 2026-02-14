import os
from django.core.asgi import get_asgi_application
from channels.routing import ProtocolTypeRouter, URLRouter
from chatbot.routing import websocket_urlpatterns

# FIX: Change 'core.settings' to 'speech_chatbot_backend.settings'
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'speech_chatbot_backend.settings')

application = ProtocolTypeRouter({
    "http": get_asgi_application(),
    "websocket": URLRouter(websocket_urlpatterns),
})