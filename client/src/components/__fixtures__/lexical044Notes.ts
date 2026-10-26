/**
 * Note bodies as lexical 0.44 serialized them, captured by running 0.44 itself.
 *
 * Stored notes outlive editor upgrades, so these stay frozen: a test reading them proves
 * the current editor still parses what an earlier one wrote. Regenerate only to add a
 * case, never to make a failing test pass.
 */

/** Heading, bold run, quote, bullet list and an image, as written by lexical 0.44. */
export const LEXICAL_044_RICH_NOTE_BODY =
  '{"root":{"children":[{"children":[{"detail":0,"format":0,"mode":"normal","style":"","text":"Renewal call","type":"text","version":1}],"direction":null,"format":"","indent":0,"type":"heading","version":1,"tag":"h2"},{"children":[{"detail":0,"format":0,"mode":"normal","style":"","text":"The ","type":"text","version":1},{"detail":0,"format":1,"mode":"normal","style":"","text":"budget approved","type":"text","version":1},{"detail":0,"format":0,"mode":"normal","style":"","text":" for Q3.","type":"text","version":1}],"direction":null,"format":"","indent":0,"type":"paragraph","version":1,"textFormat":0,"textStyle":""},{"children":[{"detail":0,"format":0,"mode":"normal","style":"","text":"Ship by Friday","type":"text","version":1}],"direction":null,"format":"","indent":0,"type":"quote","version":1},{"children":[{"children":[{"detail":0,"format":0,"mode":"normal","style":"","text":"Send contract","type":"text","version":1}],"direction":null,"format":"","indent":0,"type":"listitem","version":1,"value":1},{"children":[{"detail":0,"format":0,"mode":"normal","style":"","text":"Book demo","type":"text","version":1}],"direction":null,"format":"","indent":0,"type":"listitem","version":1,"value":2}],"direction":null,"format":"","indent":0,"type":"list","version":1,"listType":"bullet","start":1,"tag":"ul"},{"children":[{"type":"image","version":1,"src":"https://cdn.example.test/chart.png","alt":"Pipeline chart"}],"direction":null,"format":"","indent":0,"type":"paragraph","version":1,"textFormat":0,"textStyle":""}],"direction":null,"format":"","indent":0,"type":"root","version":1}}';

/** The plain-text copy the server stores beside the rich note above. */
export const LEXICAL_044_RICH_NOTE_TEXT =
  'Renewal call The budget approved for Q3. Ship by Friday Send contract Book demo';

/** A one-paragraph note, as written by lexical 0.44. */
export const LEXICAL_044_HELLO_BODY =
  '{"root":{"children":[{"children":[{"detail":0,"format":0,"mode":"normal","style":"","text":"Hello world","type":"text","version":1}],"direction":null,"format":"","indent":0,"type":"paragraph","version":1,"textFormat":0,"textStyle":""}],"direction":null,"format":"","indent":0,"type":"root","version":1}}';
