package app;

public class Greeter implements Greeting {
  public static final String DEFAULT_NAME = "World";

  private String name;

  public Greeter(String name) {
    this.name = name;
  }

  public String greet() {
    return "Hi, " + name;
  }

  public static Greeter of(String name) {
    return new Greeter(name);
  }

  static class Inner {
    void innerMethod() {}
  }
}

interface Greeting {
  String NAME_CONST = "greeting";

  String hello();

  default String bye() {
    return "bye";
  }
}

enum Color {
  RED,
  GREEN;

  public String label() {
    return name();
  }
}

record Point(int x, int y) {
  public int sum() {
    return x + y;
  }
}

@interface Marker {
  String value() default "";
}
