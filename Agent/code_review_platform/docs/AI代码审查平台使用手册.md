# AI代码审查平台使用手册

## 功能描述：目前代码审查功能仅支持方向性的代码变更审查（后续会更新）

## 一、安装代码审查平台客户端

1.  在共享盘（地址：\\192.168.0.233\软件部\00\_软件部\_开发工具）中找到安装程序，如果无法安装请联系IT $\color{#0089FF}{@吴杰泓(吴端端)}$ 
    
    [请至钉钉文档查看附件《AI代码审查客户端-v1.0.0.exe》。](https://alidocs.dingtalk.com/i/nodes/G1DKw2zgV2R00rrpFP97OozpVB5r9YAn?cid=167649945:906481689&corpId=ding566163e0ef6cb38c&doc_type=wiki_doc&iframeQuery=anchorId%3DX02mpz9gdqlsatflaoj7ah&utm_medium=im_card&utm_scene=person_space&utm_source=im)
    
    ![image.png](https://alidocs.oss-cn-zhangjiakou.aliyuncs.com/res/mPdnpEbQaJjamqw9/img/21f4ea85-1803-4a21-932c-37da1b3bc5af.png)
    
2.  选择“仅为我安装（admin）”，点击下一步。
    
    ![image.png](https://alidocs.oss-cn-zhangjiakou.aliyuncs.com/res/mPdnpEbQaJjamqw9/img/7b368818-d0f4-4e0a-906f-6800e82a2711.png)
    
3.  选择安装的目录（注意：代码审查平台生成的报告会放在你安装的位置下，请尽量不要将该平台安装到C盘下），点击安装。
    
    ![image.png](https://alidocs.oss-cn-zhangjiakou.aliyuncs.com/res/mPdnpEbQaJjamqw9/img/9a6d7c9a-6413-44c4-a248-ce4ba191e833.png)
    
4.  安装完成，如下图所示：
    

![image.png](https://alidocs.oss-cn-zhangjiakou.aliyuncs.com/res/mPdnpEbQaJjamqw9/img/138a881e-6518-4dc6-a9b7-f9aaee7c1c37.png)

## 二、客户端使用教程

### 登录

1.  首次登录使用Key登录，Key为公司内部申请的AI的API Key（如果没有可联系程工申请 $\color{#0089FF}{@程昊}$ ），注意服务端地址默认为：[http://172.23.17.242:8000](http://172.23.17.242:8000)
    
    ![image.png](https://alidocs.oss-cn-zhangjiakou.aliyuncs.com/res/mPdnpEbQaJjamqw9/img/57852459-c872-490b-80ff-d7b4032798fb.png)
    
2.  登录后可以绑定SVN账号，下次即可使用SVN登录，如果没有可以选择跳过。
    

![image.png](https://alidocs.oss-cn-zhangjiakou.aliyuncs.com/res/mPdnpEbQaJjamqw9/img/0e7a7b9f-d8b1-4cff-9223-c89838347f44.png)

### 本地环境检查（待补充）

1.  **Codex CLI 缺失**
    
2.  **SVN CLI缺失**
    
    点击，“安装SNV CLI”按钮即可，若点击后还无法安装可联系管理员 $\color{#0089FF}{@杨慧城}$ 
    
    ![image.png](https://alidocs.oss-cn-zhangjiakou.aliyuncs.com/res/mPdnpEbQaJjamqw9/img/90b0bed7-e02f-4c68-9d77-64f1385adf99.png)
    
3.  **Skill 缺失**
    

### 创建代码审查任务

填写需要审查代码的 （1）SVN仓库地址；（2）旧版本号；（3）新版本号 后，点击“开始审查”按钮即可。

（后续会更新导入excel文档的功能）

![image.png](https://alidocs.oss-cn-zhangjiakou.aliyuncs.com/res/mPdnpEbQaJjamqw9/img/164606e6-a02e-403d-94e4-6a29deeac09e.png)

### 审查报告查看

1.  如图所示，左下角为当前任务和历史任务栏，点击“查看报告”按钮即可在右侧查看生成的代码变更审查报告。
    
    ![image.png](https://alidocs.oss-cn-zhangjiakou.aliyuncs.com/res/mPdnpEbQaJjamqw9/img/080af467-4249-4976-8205-b95203bebbea.png)
    
2.  点击右上角“查看报告位置”按钮，弹出在你本地报告所保存的文件夹位置。
    

## 三、Web平台使用教程

### 登录（[http://172.23.17.242:5174/](http://172.23.17.242:5174/)）

与客户端登录相同，首次登录请使用Key登录，后续绑定SVN账号后，可使用SVN登录。

![image.png](https://alidocs.oss-cn-zhangjiakou.aliyuncs.com/res/mPdnpEbQaJjamqw9/img/3698f095-dab2-4e2d-befd-7d85c1680a1a.png)

## 四、意见反馈

 $\color{#0089FF}{@杨慧城}$ 

![image.png](https://alidocs.oss-cn-zhangjiakou.aliyuncs.com/res/mPdnpEbQaJjamqw9/img/597a4299-e5a0-4bc4-a90a-44607d689798.png)