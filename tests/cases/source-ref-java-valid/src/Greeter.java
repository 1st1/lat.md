package app;

@Deprecated
public class Greeter<T> implements Greeting {
  public static final String DEFAULT_NAME = "World";
  private String name;
  private int first = 1, second;

  public Greeter(String name) {
    this.name = name;
  }

  @Deprecated
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
  GREEN(2);

  private final int code;

  Color(int code) {
    this.code = code;
  }

  String label() {
    return name();
  }
}

record Point(int x, int y) {
  Point {
    if (x < 0) throw new IllegalArgumentException();
  }

  int sum() {
    return x + y;
  }
}

@interface Marker {
  String value() default "";
}
