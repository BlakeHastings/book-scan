Feature: Saying what a book is, when the tag does not exist yet

  A rule claims a book by its tags, so a tag is how a book gets a place. The
  check-the-details screen offered two of them, fiction and non-fiction, and a
  person holding a comic book had nothing to say. Now they can name one.

  Two things about that are worth driving a browser for, and neither of them can
  be seen on the screen alone.

  The first is that a person's tag survives the save. A save states a genre and
  the source of that statement is the same person, so restating it used to take
  back everything that person had said about the book: tag it Comic book, tap
  Fiction, save, and the Comic book tag was gone with nothing anywhere reporting
  it. The row is what says whether that is still true, so this scenario asks the
  catalogue rather than the screen.

  The second is that two spellings of one idea must not become two tags. Slugs
  are byte-ordered, so "Comic Book" and "comic books" would be two rows that sort
  apart, two counts each holding half the answer, and two rules to write. The app
  refuses, and what it refuses is drawn: the tag they already keep is offered and
  there is no way to make a second one.

  The third is the door that does not start with a book at all (#452), and it is
  the same panel: making a word from the tags screen, and sweeping it away again.

  Background:
    Given the catalogue is empty
    And the catalogue service knows about "Dune"
    And the camera is pointed at the back cover of "Dune"

  Scenario: A tag nobody had is named, and it survives the save that files the book
    When I open the app
    And I start the camera
    And I photograph the book
    Then the camera should recognise the book as "Dune"

    When I review what it found
    And I name a new tag "Comic book"
    Then the book should be tagged "Comic book"

    # The genre, answered by the two options rather than by the box. This is the
    # pair that used to wipe each other out.
    When I say the book is fiction
    And I confirm the details and go to shelve it
    And I say it fits and save it

    Then the catalogue should have "Dune" tagged:
      | Comic book  | person |
      | Fiction     | person |
    # The whole collection, not this book: one word means one tag.
    And the collection should keep one tag reading "Comic book"

  Scenario: A second spelling finds the tag rather than making another
    Given the collection already keeps a tag called "Comic book"
    When I open the app
    And I start the camera
    And I photograph the book
    Then the camera should recognise the book as "Dune"

    When I review what it found
    And I start naming a tag as "comic books"
    Then it should offer "Comic book" and no way to make another

    When I add the tag it offers
    Then the book should be tagged "Comic book"
    And the collection should keep one tag reading "Comic book"

  # The third door (#452). The two above both start with a book in your hand;
  # this one starts with nothing, which is the whole point of it: #400 lets a
  # placement rule ask for a tag nothing carries, so somebody setting up a
  # bookcase for a subject before they own a book for it was doing exactly what
  # the rules already support and had no way to say it.
  #
  # Worth driving a browser for the same reason the two above are: what has to be
  # true is a row, and the screen cannot be asked whether one exists. The word is
  # made with no book anywhere near it, the collection is asked, and then it is
  # swept away again, because making without removing leaves a screen that only
  # accumulates.
  Scenario: A word is made with no book in your hand, and swept away again
    When I open the app
    And I open my tags
    And I make a new tag "Hydrology"

    Then the collection should keep one tag reading "Hydrology"
    # The evidence the person who just made one has. A word nothing carries and
    # no rule asks for is litter, and the screen says so by offering to sweep it.
    And my tags should offer to sweep away "Hydrology"

    When I sweep away "Hydrology"
    Then the collection should keep no tag reading "Hydrology"

  Scenario: The box will not write a genre, whatever is typed into it
    When I open the app
    And I start the camera
    And I photograph the book
    Then the camera should recognise the book as "Dune"

    # #304: this app states a genre only when a source did, and a person
    # answering the two options is that person answering. Typing the word is not.
    When I review what it found
    And I start naming a tag as "fiction"
    Then it should offer no way to make another
    And it should say the two are above the box
