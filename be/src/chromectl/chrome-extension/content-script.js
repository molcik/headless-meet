
var input, button, timeout = 200

var main = () => {
  timeout = timeout - 1
  button = getElementByXpath('//span[contains(text(),"join")]')
  input = getElementByXpath('//input[@type="text"]')
  actionChain([ clickButton, fillInput], 200)
  if (timeout !== 0) return true
}

var delayedLoop = (loop, delay) => {
  setTimeout(() => {
    var resume = loop()
    if (resume) delayedLoop(loop, delay)
  }, delay);
}

var actionChain = (actions, delay) => {
  setTimeout(() => {
    var action = actions.pop()
    action()
    if (actions.length > 0) actionChain(actions, delay)
  }, delay)
}

var fillInput = () => {
  if (!input) return
    input.focus()
    document.execCommand('selectAll', false);
    document.execCommand('insertText', false, 'Meeting Room');
}

var clickButton = () => {
  if (!button) return
  button.dispatchEvent(getMouseEvent())
}

var getElementByXpath = (path) => {
  return document.evaluate(path, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
}

var getMouseEvent = () => {
    return new MouseEvent("click", nr())
}
var getMouseEventProperties = nr = () => {
    return {
        screenX: 10,
        screenY: 10,
        clientX: 10,
        clientY: 10,
        bubbles: !0,
        cancelable: !0,
        view: window
    }
}


delayedLoop(main, 1000)