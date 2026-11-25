import cv2
import numpy as np
from pathlib import Path
cap = cv2.VideoCapture(str(Path(__file__).parents[1] / 'public/video/nori-startup.mp4'))
fps=cap.get(cv2.CAP_PROP_FPS); frames=cap.get(cv2.CAP_PROP_FRAME_COUNT)
print('Video', cap.get(cv2.CAP_PROP_FRAME_WIDTH), cap.get(cv2.CAP_PROP_FRAME_HEIGHT), fps, frames/fps)
out=[]
for t in (0,.5,1,2,3,4,6,8,10,12,14,16):
    cap.set(cv2.CAP_PROP_POS_MSEC,t*1000)
    ok, im=cap.read()
    if ok:
        im=cv2.resize(im,(400,225)); cv2.putText(im,str(t),(8,25),cv2.FONT_HERSHEY_SIMPLEX,.7,(255,255,255),2)
        out.append(im)
cv2.imwrite(str(Path(__file__).parents[1] / 'startup-review.jpg'), np.vstack([np.hstack(out[i:i+3]) for i in range(0,len(out),3)]))
