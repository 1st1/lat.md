import 'package:flutter/material.dart';

class MyWidget extends StatelessWidget {
  const MyWidget({super.key});

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: .start,
    children: [
      const Text('hello'),
    ],
  );
}
