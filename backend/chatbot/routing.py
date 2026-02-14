from django.urls import re_path
from . import server_core

websocket_urlpatterns = [
    re_path(r'ws/chat/$', server_core.ChatConsumer.as_asgi()),
]