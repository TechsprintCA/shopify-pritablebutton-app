import nodemailer from 'nodemailer';
import 'dotenv/config';

// Create transporter with SMTP configuration
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_PORT === '465', // true for 465, false for other ports
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// Beautiful HTML email template
const createEmailTemplate = (customerName, productTitle, downloadUrl, shopDomain) => {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Your Digital Download is Ready!</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            line-height: 1.6;
            color: #333;
            background-color: #f8f9fa;
        }
        .container {
            max-width: 600px;
            margin: 0 auto;
            background-color: #ffffff;
            border-radius: 12px;
            overflow: hidden;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.1);
        }
        .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            padding: 40px 30px;
            text-align: center;
            color: white;
        }
        .header h1 {
            font-size: 28px;
            font-weight: 700;
            margin-bottom: 10px;
        }
        .header p {
            font-size: 16px;
            opacity: 0.9;
        }
        .content {
            padding: 40px 30px;
        }
        .greeting {
            font-size: 18px;
            color: #2c3e50;
            margin-bottom: 20px;
        }
        .product-card {
            background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
            border-radius: 12px;
            padding: 30px;
            margin: 30px 0;
            text-align: center;
            color: white;
        }
        .product-title {
            font-size: 22px;
            font-weight: 600;
            margin-bottom: 15px;
        }
        .download-btn {
            display: inline-block;
            background: #ffffff;
            color: #f5576c;
            padding: 15px 30px;
            border-radius: 50px;
            text-decoration: none;
            font-weight: 600;
            font-size: 16px;
            margin-top: 20px;
            transition: all 0.3s ease;
            box-shadow: 0 4px 15px rgba(0, 0, 0, 0.2);
        }
        .download-btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 20px rgba(0, 0, 0, 0.3);
        }
        .features {
            margin: 30px 0;
            padding: 20px;
            background: #f8f9fa;
            border-radius: 8px;
            border-left: 4px solid #667eea;
        }
        .features h3 {
            color: #2c3e50;
            margin-bottom: 15px;
            font-size: 18px;
        }
        .features ul {
            list-style: none;
            padding: 0;
        }
        .features li {
            padding: 8px 0;
            position: relative;
            padding-left: 25px;
        }
        .features li:before {
            content: "✓";
            position: absolute;
            left: 0;
            color: #27ae60;
            font-weight: bold;
        }
        .support {
            background: #e8f4fd;
            padding: 20px;
            border-radius: 8px;
            margin: 30px 0;
            text-align: center;
        }
        .support h3 {
            color: #2980b9;
            margin-bottom: 10px;
        }
        .footer {
            background: #2c3e50;
            color: #ecf0f1;
            padding: 30px;
            text-align: center;
        }
        .footer p {
            margin-bottom: 10px;
        }
        .social-links {
            margin-top: 20px;
        }
        .social-links a {
            display: inline-block;
            margin: 0 10px;
            color: #ecf0f1;
            text-decoration: none;
        }
        @media (max-width: 600px) {
            .container {
                margin: 10px;
                border-radius: 8px;
            }
            .header, .content, .footer {
                padding: 20px;
            }
            .header h1 {
                font-size: 24px;
            }
            .product-title {
                font-size: 18px;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🎉 Download Ready!</h1>
            <p>Your digital product is now available</p>
        </div>
        
        <div class="content">
            <div class="greeting">
                Hello ${customerName || 'Valued Customer'},
            </div>
            
            <p>Thank you for your purchase! Your digital download is now ready and waiting for you.</p>
            
            <div class="product-card">
                <div class="product-title">📄 ${productTitle}</div>
                <p>High-quality digital content, ready for instant download</p>
                <a href="${downloadUrl}" class="download-btn">
                    📥 Download Now
                </a>
            </div>
            
            <div class="features">
                <h3>What's Included:</h3>
                <ul>
                    <li>Instant download access</li>
                    <li>High-quality PDF format</li>
                    <li>Lifetime access to your purchase</li>
                    <li>Mobile and desktop compatible</li>
                </ul>
            </div>
            
            <div class="support">
                <h3>Need Help?</h3>
                <p>If you have any questions or issues with your download, please don't hesitate to contact our support team.</p>
            </div>
            
            <p><strong>Important:</strong> Please save this email for your records. You can use this download link anytime to access your purchase.</p>
            
            <p>Thank you for choosing us!</p>
        </div>
        
        <div class="footer">
            <p><strong>${shopDomain}</strong></p>
            <p>This email was sent because you made a purchase from our store.</p>
            <p>© ${new Date().getFullYear()} ${shopDomain}. All rights reserved.</p>
        </div>
    </div>
</body>
</html>
  `;
};

// Send download email function
export const sendDownloadEmail = async (customerEmail, customerName, productTitle, downloadUrl, shopDomain) => {
  try {
    const htmlContent = createEmailTemplate(customerName, productTitle, downloadUrl, shopDomain);
    
    const mailOptions = {
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: customerEmail,
      subject: `🎉 Your "${productTitle}" is Ready for Download!`,
      html: htmlContent,
      text: `Hello ${customerName || 'Valued Customer'},

Thank you for your purchase! Your digital download "${productTitle}" is now ready.

Download Link: ${downloadUrl}

Please save this email for your records. You can use this download link anytime to access your purchase.

Thank you for choosing ${shopDomain}!

Best regards,
${shopDomain} Team`
    };

    const result = await transporter.sendMail(mailOptions);
    console.log('Email sent successfully:', result.messageId);
    return { success: true, messageId: result.messageId };
  } catch (error) {
    console.error('Error sending email:', error);
    return { success: false, error: error.message };
  }
};

export default { sendDownloadEmail };
