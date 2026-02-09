import React, { useState } from "react";
import {
    View,
    Text,
    TextInput,
    Pressable,
    StyleSheet,
    Platform,
    Animated,
} from "react-native";
import { MaterialIcons } from "@expo/vector-icons";

type EntryMode = "voice" | "text";
type HintMode = "off" | "hint" | "tutor";

type Props = {
    entryMode: EntryMode;
    onToggleMode: () => void;
    onGoVoiceMode: () => void;
    

    input: string;
    onChangeInput: (v: string) => void;

    inputTx: any;       // Animated interpolation
    inputOpacity: any;  // Animated interpolation

    onPrimaryPress: () => void;
    inlineButtonExpanded: boolean;
    inlineButtonContent: React.ReactNode;

    hintMode: HintMode;
    onHintModeChange: (m: HintMode) => void;
};

export default function BottomBar({
    entryMode,
    onToggleMode,
    onGoVoiceMode,
    input,
    onChangeInput,
    inputTx,
    inputOpacity,
    onPrimaryPress,
    inlineButtonExpanded,
    inlineButtonContent,
    hintMode,
    onHintModeChange,

}: Props) {

    const [isHovered, setIsHovered] = useState(false);
    const [isSendHovered, setIsSendHovered] = useState(false);
    const [isTutorHovered, setIsTutorHovered] = useState(false);
    const [isHintHovered, setIsHintHovered] = useState(false);
    const [isOffHovered, setIsOffHovered] = useState(false);

    return (


        <View style={[styles.bottomBar, Platform.OS === "web" && styles.bottomBarWeb]}>
            {/* Tt toggle LEFT */}

            {entryMode === "voice" ? (

                <Pressable
                    onPress={onToggleMode}
                    onHoverIn={() => setIsHovered(true)}
                    onHoverOut={() => setIsHovered(false)}
                    style={[styles.modeBtn, isHovered && styles.modeBtnHovered, hintMode === "off" && styles.hide,
                    Platform.OS === "web" ? ({ cursor: "pointer" } as any) : ({position:"absolute", bottom: 5})]}
                >
                    <View style={[styles.modeBtnInWrap, Platform.OS === "web" && styles.modeBtnInWrapWeb]}>
                        <View style={[{ flexDirection: "row" },
                        Platform.OS === "web" ? ({ alignItems: "flex-start" } as any) : ({ alignItems: "center" })
                        ]}>
                            <Text
                                selectable={false}
                                style={[{ color: "#000000", fontWeight: "900", lineHeight: 30 },
                                Platform.OS === "web" ? ({ userSelect: "none", fontSize: 20 } as any) : ({ userSelect: undefined, fontSize: 23 } as any),]}
                            >
                                Tt
                            </Text>
                            <MaterialIcons name="arrow-right" size={Platform.OS === "web" ? 30 : 45} color="#000000" style={{ marginLeft: -2 }} />
                        </View>
                    </View>
                </Pressable>
                // ) : null}
            ) : 
                <Pressable
                    onPress={onToggleMode}
                    onHoverIn={() => setIsHovered(true)}
                    onHoverOut={() => setIsHovered(false)}
                    style={[isHovered && styles.modeBtnHovered,
                    Platform.OS === "web" ? ({ cursor: "pointer" } as any) : ({position:"absolute", bottom: 0, width: 60, height: 60, zIndex: 54})]}
                >
                    <MaterialIcons name="arrow-left" size={Platform.OS === "web" ? 45 : 60} color="#000000" style={[
                        Platform.OS === "web" ? ({ marginTop: undefined, marginLeft: -12, marginRight: -10 } as any) : ({ marginLeft: -12, marginRight: 10 })
                    ]} />
                </Pressable>
            }
            {/* Input bar CENTER (text mode only) */}
            <Animated.View
                style={{
                    flex: 1,
                    marginLeft: 12,
                    transform: [{ translateX: inputTx }],
                    opacity: inputOpacity,
                }}
                pointerEvents={entryMode === "text" ? "auto" : "none"}
            >
                <View style={styles.textBar}>
                    <TextInput
                        style={[styles.input, Platform.OS === "web" && styles.input, webOnlyInput]}
                        placeholder="Ask Anything"
                        placeholderTextColor={"#8e8e8e"}
                        value={input}
                        onChangeText={onChangeInput}
                        multiline
                    />

                    <Pressable
                        onPress={onPrimaryPress}
                        onHoverIn={() => setIsSendHovered(true)}
                        onHoverOut={() => setIsSendHovered(false)}
                        style={[
                            styles.inlineSendButton,
                            inlineButtonExpanded && styles.inlineSendButtonWide,
                            isSendHovered && styles.inlineSendHover
                        ]}
                    >
                        {inlineButtonContent}
                    </Pressable>
                </View>
            </Animated.View>

            {/* Help bar RIGHT */}
            <View style={styles.helpBarWrap}>
                <View style={styles.segment}>
                    <Pressable
                        onPress={() => onHintModeChange("tutor")}
                        onHoverIn={() => setIsTutorHovered(true)}
                        onHoverOut={() => setIsTutorHovered(false)}

                        style={[
                            styles.segmentBtn,
                            hintMode === "tutor" && styles.segmentBtnActive,
                            isTutorHovered && styles.segmentBtnHovered,
                            Platform.OS === "web" ? ({ cursor: "pointer" } as any) : undefined
                        ]}
                    >
                        <Text style={[
                            styles.segmentText,
                            hintMode === "tutor" && styles.segmentTextActive,
                            Platform.OS === "web" ? ({ userSelect: "none" } as any) : undefined,
                        ]}
                            selectable={false}
                        >
                            Tutor
                        </Text>
                    </Pressable>

                    <Pressable
                        onPress={() => onHintModeChange("hint")}
                        onHoverIn={() => setIsHintHovered(true)}
                        onHoverOut={() => setIsHintHovered(false)}
                        style={[
                            styles.segmentBtn,
                            styles.segmentMiddle,
                            hintMode === "hint" && styles.segmentBtnActive,
                            isHintHovered && styles.segmentBtnHovered,
                            Platform.OS === "web" ? ({ cursor: "pointer" } as any) : undefined
                        ]}
                    >
                        <Text style={[
                            styles.segmentText,
                            hintMode === "hint" && styles.segmentTextActive,
                            Platform.OS === "web" ? ({ userSelect: "none" } as any) : undefined,
                        ]}
                            selectable={false}
                        >
                            Hint
                        </Text>
                    </Pressable>

                    <Pressable
                        onPress={() => {
                            onHintModeChange("off"); 
                            onGoVoiceMode();
                        }}
                        onHoverIn={() => setIsOffHovered(true)}
                        onHoverOut={() => setIsOffHovered(false)}
                        style={[
                            styles.segmentBtn,
                            hintMode === "off" && styles.segmentBtnActive,
                            isOffHovered && styles.segmentBtnHovered,
                            Platform.OS === "web" ? ({ cursor: "pointer" } as any) : undefined
                        ]}
                    >
                        <Text
                        style={[
                            styles.segmentText,
                            hintMode === "off" && styles.segmentTextActive,
                            Platform.OS === "web" ? ({ userSelect: "none" } as any) : undefined,
                        ]}
                            selectable={false}
                        >
                            Off
                        </Text>
                    </Pressable>
                </View>
            </View>
        </View>
    );
}
const webOnlyInput = Platform.select({
    web: {
        // borderTopWidth: 1,
        borderRadius: 40,
        boxShadow: '0 8px 20px 5px rgba(0, 0, 0, 0.1)',
        paddingTop: 20,
        paddingBottom: 5,
        paddingHorizontal: 35,
        outlineStyle: "none",
    } as any,
    default: {},
});

const styles = StyleSheet.create({
    bottomBar: {
        flexDirection: "row",
        alignItems: "center",
        paddingTop: 10,
        paddingBottom: 0,
    },
    bottomBarWeb: {
        position: "fixed",
        left: 20,
        right: 20,
        bottom: 12,
        zIndex: 51
    },

    modeBtn: {
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: "center",
        justifyContent: "center",
        zIndex: 55

    },
    modeBtnHovered: {
        opacity: 0.6,
    },
    modeBtnInWrap: {
        width: 58,
        height: 58,
        justifyContent: "flex-start",
        alignItems: "flex-start"
    },
    modeBtnInWrapWeb: {
        width: 48,
        height: 48,
        justifyContent: "center",
        alignItems: "center"
    },

    textBar: {
        position: "relative",
        justifyContent: "center",
        marginBottom: Platform.OS === "web" ? 0 : 55,
        marginRight: Platform.OS === "web" ? 230 : -40,
        marginLeft: Platform.OS === "web" ? 180 : -50,
  
    },
    input: {
        borderColor: "#8e8e8e",
        boxShadow: '0 -10px 18px -12px rgba(0, 0, 0, 0.2)',
        borderStartEndRadius: 40,
        borderStartStartRadius: 40,
        paddingTop: 20,
        paddingBottom: 20,
        paddingLeft: 40,
        paddingRight: 40,
        fontSize: 16,
        minHeight: 48,
    },

    inlineSendButton: {
        position: "absolute",
        right: Platform.OS === "web" ? 13 : 30,
        top: Platform.OS === "web" ? 8 : undefined,
        bottom: -50,
        width: 50,
        height: 50,
        borderRadius: 25,
        backgroundColor: "#000",
        alignItems: "center",
        justifyContent: "center",
    },
    inlineSendButtonWide: {
        width: 96,
        borderRadius: 40,
        paddingHorizontal: 12,
        alignItems: "center",
        justifyContent: "center",
    },
    inlineSendHover: {
        opacity: 0.7
    },
    helpBarWrap: {
        position: "absolute",
        backgroundColor: "#f3f3f3",
        marginBottom: Platform.OS === "web" ? 75 : 10,
        height: Platform.OS === "web" ? 75 : "auto",
        width: Platform.OS === "web" ? 120 : 140,
        bottom: Platform.OS === "web" ? undefined : 0,
        right: Platform.OS === "web" ? 3 : undefined,
        left: Platform.OS === "web" ? undefined : "46.5%",
        marginLeft: Platform.OS === "web" ? 0 : -59.5, // half of width (120/2) to center
    },

    segment: {
        flexDirection: Platform.OS === "web" ? "column" : "row",
        borderWidth: Platform.OS === "web" ? 0 : 1,
        boxShadow: Platform.OS === "web" ? '0 8px 20px 5px rgba(0, 0, 0, 0.1)' : undefined,
        borderColor: "#8e8e8e",
        borderRadius: 12,
        overflow: "hidden",
    },
    segmentBtn: {
        flex: 1,
        paddingVertical: 10,
        marginHorizontal: -0.5,
        alignItems: "center",
        justifyContent: "center",
        
    },
    segmentMiddle:
        Platform.OS === "web"
            ? { borderTopWidth: 1, borderBottomWidth: 1, borderColor: "#8e8e8e" }
            : { borderLeftWidth: 1, borderRightWidth: 1, borderColor: "#8e8e8e" },

    segmentBtnHovered: { opacity: 0.8, boxShadow: Platform.OS === "web" ? '0 0 20px 5px rgba(0, 0, 0, 0.1)' : undefined, },
    segmentBtnActive: { backgroundColor: "#000" },
    segmentText: { fontSize: 12, fontWeight: "600", color: "#000" },
    segmentTextActive: { color: "#dcf9ff" },
    hide:{display:"none"}
});
