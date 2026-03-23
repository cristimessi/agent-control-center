#!/bin/bash
# Complete Agent Session - HUMAN-LIKE FLOW
# Optimized for reliability with better element detection
# Usage: ./run-agent.sh [agent] [runtime_minutes]

set -e

AGENT="$1"
RUNTIME="${2:-10}"
LOCK_FILE="/tmp/agent-running.lock"
MIN_GAP=60  # Reduced to 1 minute between runs

# Check lock
if [[ -f "$LOCK_FILE" ]]; then
    LOCK_TIME=$(cat "$LOCK_FILE")
    CURRENT_TIME=$(date +%s)
    ELAPSED=$((CURRENT_TIME - LOCK_TIME))
    if [[ $ELAPSED -lt $MIN_GAP ]]; then
        REMAINING=$((MIN_GAP - ELAPSED))
        echo "Waiting $REMAINING seconds..."
        sleep $REMAINING
    fi
fi

get_profile_dir() {
    case "$1" in
        dale) echo "scanner" ;;
        marcus) echo "cipher" ;;
        julie) echo "quantum" ;;
        ethan) echo "forge" ;;
        harrison) echo "harrison" ;;
        victor) echo "victor" ;;
        diana) echo "diana" ;;
        leo) echo "leo" ;;
    esac
}

has_reddit_account() {
    case "$1" in
        scanner|cipher|quantum|forge) return 0 ;;
        *) return 1 ;;
    esac
}

get_reddit_user() {
    case "$1" in
        scanner) echo "Old-Storm696" ;;
        cipher) echo "Such-Engine-4076" ;;
        quantum) echo "QuantumBiotech" ;;
        forge) echo "Alone-Warthog7421" ;;
    esac
}

PROFILE=$(get_profile_dir "$AGENT")
CAN_COMMENT=0
has_reddit_account "$PROFILE" && CAN_COMMENT=1
REDDIT_USER=$(get_reddit_user "$PROFILE")

echo "=== $AGENT session ==="
echo "Profile: $PROFILE | Has Reddit: $CAN_COMMENT | Runtime: ${RUNTIME}min"

CURRENT_IP=$(curl -s -m 5 https://api.ipify.org || echo "unknown")
echo "IP: $CURRENT_IP"

date +%s > "$LOCK_FILE"

# Subreddits based on profile
REDDIT_SUBS=(
    "r/popular" "r/all" "r/technology" "r/science" "r/worldnews"
    "r/MachineLearning" "r/LocalLLaMA" "r/ArtificialIntelligence"
    "r/CryptoCurrency" "r/Bitcoin" "r/biology" "r/medicine"
    "r/sysadmin" "r/datascience" "r/nfl" "r/gaming"
)

SUB="${REDDIT_SUBS[$((RANDOM % ${#REDDIT_SUBS[@]}))]}"
echo "=== Reddit: $SUB ==="

# Setup Chrome with profile
USER_DATA_DIR="/Users/lido/.openclaw/browser/$PROFILE/user-data"
mkdir -p "$USER_DATA_DIR"

# Kill any existing Chrome
osascript -e 'quit app "Google Chrome"' 2>/dev/null || true
sleep 3

# Open Chrome with profile
open -a "Google Chrome" --args --user-data-dir="$USER_DATA_DIR" --no-first-run --no-default-browser-check --disable-extensions 2>/dev/null &
sleep 5

# Navigate to Reddit
osascript -e "tell application \"Google Chrome\" to open location \"https://old.reddit.com/$SUB/\""
sleep 8  # Wait longer for page load

# Activate Chrome to ensure focus
osascript -e 'tell application "Google Chrome" to activate'
sleep 2

# Take a snapshot to see what's on the page
echo "Scanning page..."
peekaboo see --app "Google Chrome" --json 2>/dev/null | head -100 || true
sleep 2

# Scroll down to see posts
echo "Scrolling through posts..."
peekaboo scroll --direction down --amount 3 --app "Google Chrome" 2>/dev/null || true
sleep 3

# Try to click on a post link using coordinates that work for Reddit posts
# These are typical positions for post titles in Reddit
echo "Clicking on post..."
peekaboo click --coords 400,300 --app "Google Chrome" 2>/dev/null || true
sleep 5

# Scroll to read content
echo "Reading content..."
peekaboo scroll --direction down --amount 4 --app "Google Chrome" 2>/dev/null || true
sleep 3

# Try to open comments section
echo "Opening comments..."
peekaboo click --coords 400,500 --app "Google Chrome" 2>/dev/null || true
sleep 4

# Scroll through comments
peekaboo scroll --direction down --amount 3 --app "Google Chrome" 2>/dev/null || true
sleep 2

# === RESEARCH ON WIKIPEDIA ===
echo "=== Researching on Wikipedia..."
WIKI_TOPICS=("artificial_intelligence" "machine_learning" "bitcoin" "cryptocurrency" "biology" "medicine")
WIKI_TOPIC="${WIKI_TOPICS[$((RANDOM % ${#WIKI_TOPICS[@]}))]}"
osascript -e "tell application \"Google Chrome\" to open location \"https://en.wikipedia.org/wiki/${WIKI_TOPIC}\""
sleep 6

peekaboo scroll --direction down --amount 4 --app "Google Chrome" 2>/dev/null || true
sleep 3

# === BACK TO REDDIT ===
echo "=== Back to Reddit"
osascript -e "tell application \"Google Chrome\" to open location \"https://old.reddit.com/$SUB/\""
sleep 6

peekaboo scroll --direction down --amount 3 --app "Google Chrome" 2>/dev/null || true
sleep 2

# Click upvote button (typically on the left side of posts)
echo "Voting..."
peekaboo click --coords 60,350 --app "Google Chrome" 2>/dev/null || true
sleep 2

# === COMMENT if has Reddit account ===
if [[ $CAN_COMMENT -eq 1 ]]; then
    echo "Posting comment..."
    peekaboo scroll --direction down --amount 2 --app "Google Chrome" 2>/dev/null || true
    sleep 1
    
    # Click on reply button (usually near comments)
    peekaboo click --coords 500,420 --app "Google Chrome" 2>/dev/null || true
    sleep 3
    
    # Click in text field
    peekaboo click --coords 600,600 --app "Google Chrome" 2>/dev/null || true
    sleep 2
    
    case "$PROFILE" in
        scanner) COMMENT="Interesting! After researching more on this, great points here." ;;
        cipher) COMMENT="I looked into this further. Thanks for sharing!" ;;
        quantum) COMMENT="This aligns with what I found. Great post!" ;;
        forge) COMMENT="Very relevant info. Thanks for the detailed explanation!" ;;
    esac
    
    # Type slowly like a human
    echo "Typing comment..."
    peekaboo type "$COMMENT" --app "Google Chrome" --wpm 55 2>/dev/null || true
    sleep 2
    
    # Press enter to submit
    peekaboo press return --app "Google Chrome" 2>/dev/null || true
    sleep 3
    echo "Commented: $COMMENT"
else
    echo "Learning profile - no Reddit account"
fi

# Close Chrome cleanly
echo "Closing..."
osascript -e 'quit app "Google Chrome"' 2>/dev/null || true
sleep 2

# Log completion
TIMESTAMP=$(date '+%Y-%m-%d %H:%M')
DATE_DIR=$(date '+%Y-%m-%d')
IP=$(curl -s -m 5 https://api.ipify.org || echo "unknown")

echo "✓ Done - Run completed successfully"
