import React from 'react';
import { View, Text, Image, TouchableOpacity, Linking, StyleSheet } from 'react-native';

// Very naive parser for <View style="...">...</View> just for the example
export function renderJsxString(jsxString: string): React.ReactNode[] {
  // We'll just render it as Text for now to avoid writing a full AST parser in the example.
  // Real implementation would use an XML parser to map tags to RN components.
  // For demonstration, let's look for specific patterns or just fallback.
  
  if (jsxString.includes('<TouchableOpacity')) {
    // extract onPress
    const urlMatch = jsxString.match(/onPress="([^"]+)"/);
    const textMatch = jsxString.match(/>([^<]+)<\/Text>/);
    const topMatch = jsxString.match(/top:\s*([^;"]+)/);
    const leftMatch = jsxString.match(/left:\s*([^;"]+)/);

    const url = urlMatch ? urlMatch[1] : '';
    const text = textMatch ? textMatch[1].trim() : 'Click me';
    const top = topMatch ? topMatch[1].trim() : '10%';
    const left = leftMatch ? leftMatch[1].trim() : '10%';

    return [
      <TouchableOpacity 
        key="1"
        style={{ position: 'absolute', top: top as any, left: left as any, backgroundColor: 'rgba(229, 9, 20, 0.8)', padding: 10, borderRadius: 8 }}
        onPress={() => url && Linking.openURL(url)}
      >
        <Text style={{ color: 'white', fontWeight: 'bold' }}>{text}</Text>
      </TouchableOpacity>
    ];
  }

  return [<Text key="text" style={{ position: 'absolute', top: 50, left: 50, color: 'white' }}>{jsxString}</Text>];
}
