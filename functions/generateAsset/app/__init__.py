import logging

if logging.getLogger().hasHandlers():
    # The Lambda environment pre-configures a handler logging to stderr. If a
    # handler is already configured, `.basicConfig` does not execute. Thus we
    # set the level directly.
    logging.getLogger().setLevel(logging.INFO)
else:
    # For logging locally.
    logging.basicConfig(
        format="[%(levelname)s] - [%(asctime)s] - %(message)s", level=logging.INFO,
    )

logger = logging.getLogger()
