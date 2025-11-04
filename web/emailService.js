import nodemailer from 'nodemailer';
// import 'dotenv/config';

// Create transporter with SMTP configuration
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_PORT === '465', // true for 465, false for other ports
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  logger: true,    // enable transport-level logging
  debug: true,     // include SMTP-level debug output

});

// Beautiful HTML email template
const createEmailTemplate = (customerName, productTitle, downloadUrl, shopDomain, productImageUrl = null) => {
  const imageUrl = productImageUrl || 'https://cdn.shopify.com/s/files/1/0931/6453/6129/files/Screenshot_2025-10-30_123528.png?v=1761809763';
  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Your Download is Ready!</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Urbanist:ital,wght@0,100..900;1,100..900&display=swap');
        * {
            margin: 0;
            padding: 0;
            font-family: 'Urbanist', sans-serif;
        }
        .button {
            border-radius: 10px;
            background: #eea527;
            display: inline-block;
            padding-top: 6px;
            padding: 10px 20px;
            padding-top: 6px;
            color: #fff;
            transition: all 0.25s;
            font-weight: bold;
        }

        .primary-button {
            background-color: #e7635c;
            border-color:rgb(232, 163, 159);
            border-width: 5px;
            border-style: solid;
            text-decoration: none;
        }
        .primary-button:hover {
            background-color: #d5807b;
        }
        .button-arrow {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            white-space: nowrap;
            gap: 15px;
        }
        .button-arrow svg {
            max-width: 25px;
            min-width: 25px;
        }

        @media (min-width: 1501px) {
            .button {
                font-size: 24px;
            }
        }
        @media (max-width: 540px) {
            .button {
                font-size: 18px;
                padding: 5px 10px;
            }
        }
        @media screen and (max-width: 768px) {
            .button-arrow svg {
                max-width: 15px;
                min-width: 15px;
            }
        }

        /* Section 1 - Hero Responsive */
        .hero-section {
            background-image: url(https://cdn.shopify.com/s/files/1/0931/6453/6129/files/Screenshot_2025-10-30_113947.png?v=1761808148);
            background-size: cover;
            background-repeat: no-repeat;
            background-position: center;
        }

        /* Mobile Screens - Gmail Compatible */
        @media only screen and (max-width: 600px), only screen and (max-device-width: 600px) {
            /* Prevent auto-scaling */
            * {
                -webkit-text-size-adjust: none !important;
                -ms-text-size-adjust: none !important;
            }
            
            /* Text sizes - multiple selectors for Gmail */
            h1, h1[style] {
                font-size: 28px !important;
                line-height: 1.3 !important;
            }
            h2, h2[style] {
                font-size: 26px !important;
                line-height: 1.3 !important;
            }
            h3, h3[style] {
                font-size: 24px !important;
                line-height: 1.3 !important;
            }
            p, p[style] {
                font-size: 16px !important;
                line-height: 1.5 !important;
            }
            
            /* Table widths */
            table[width="600"] {
                width: 100% !important;
            }
            
            /* Hero section */
            .hero-section {
                background-image: url(https://cdn.shopify.com/s/files/1/0931/6453/6129/files/Screenshot_2025-11-03_230722.png?v=1762193415) !important;
                background-size: contain !important;
            }
            
            /* Product showcase */
            .product-showcase {
                border-radius: 20px !important;
                width: 95% !important;
            }
            .product-image,
            .product-info {
                display: block !important;
                width: 100% !important;
                padding: 0 !important;
            }
            .product-image {
                padding-bottom: 20px !important;
                text-align: center !important;
            }
            .product-image img {
                max-width: 200px !important;
                width: 200px !important;
                height: auto !important;
                margin: 0 auto !important;
            }
            
            /* Product description - more specific */
            .product-description, 
            .product-description[style],
            td .product-description {
                font-size: 15px !important;
                padding: 0 10px !important;
                line-height: 1.4 !important;
            }
            
            /* Button text - more specific */
            .button-arrow span,
            .button-arrow span[style],
            a span[style*="font-size"] {
                font-size: 18px !important;
            }
            
            /* Button icon */
            .button-arrow img {
                width: 18px !important;
                height: 18px !important;
            }
            
            /* Section 4 - Info columns */
            .info-section {
                width: 100% !important;
            }
            .info-column {
                display: block !important;
                width: 100% !important;
                padding: 0 !important;
                margin-bottom: 0 !important;
            }
            .divider-vertical {
                display: none !important;
            }
            .divider-horizontal {
                display: table !important;
                width: 100% !important;
            }
            
            /* Adjust list font size */
            ul, ul li {
                font-size: 16px !important;
            }
            
            /* Section 5 - CTA */
            .cta-section {
                width: 95% !important;
                padding: 40px 25px !important;
                border-radius: 25px !important;
            }
            .cta-description {
                font-size: 16px !important;
            }
            .cta-button {
                font-size: 20px !important;
                padding: 15px 35px !important;
            }
            
            /* Section 6 - Notice */
            .notice-section {
                width: 95% !important;
            }
            .collage-image {
                max-width: 100% !important;
            }
            .notice-text {
                font-size: 20px !important;
            }
            table[style*="background-color: #e4a947"] {
                padding: 20px 25px !important;
                border-radius: 15px !important;
            }
            /* Reduce outer padding for Section 6 */
            table[style*="padding: 50px 20px"]:last-of-type {
                padding: 30px 15px !important;
            }
            
            /* Colorful Border - Force Full Width on Mobile */
            .color-border {
                width: 100% !important;
                min-width: 100% !important;
            }
            .color-border td {
                display: table-cell !important;
                width: 20% !important;
                min-width: 20% !important;
            }
        }
    </style>
</head>
<body>
    <!-- Section 1: Hero - Download Ready -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0" class="hero-section" style="background-color: #ffffff; padding: 60px 20px;">
        <tr>
            <td align="center">
                <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width: 600px;">
                    <tr>
                        <td align="center" style="padding-bottom: 30px;">
                            <img src="https://cdn.shopify.com/s/files/1/0931/6453/6129/files/E_Website_About_Page_7DP_2_2_copy-04.jpg?v=1761755674" alt="Download Ready" style="width: 150px; height: 150px; display: block;" />
                        </td>
                    </tr>
                    <tr>
                        <td align="center">
                            <h1 style="font-family: 'Urbanist', Arial, sans-serif; font-size: 48px; font-weight: 900; color: #000000; margin: 0; padding: 0; line-height: 1.2;">Your Download is Ready!</h1>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
    
    <!-- Colorful Border -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0" class="color-border" role="presentation" style="width: 100%; min-width: 100%; table-layout: fixed;">
        <tr>
            <td width="20%" style="background-color: #7bbae0; height: 8px; line-height: 8px; font-size: 8px; mso-line-height-rule: exactly; width: 20%;">&nbsp;</td>
            <td width="20%" style="background-color: #e4a947; height: 8px; line-height: 8px; font-size: 8px; mso-line-height-rule: exactly; width: 20%;">&nbsp;</td>
            <td width="20%" style="background-color: #c55899; height: 8px; line-height: 8px; font-size: 8px; mso-line-height-rule: exactly; width: 20%;">&nbsp;</td>
            <td width="20%" style="background-color: #d86b61; height: 8px; line-height: 8px; font-size: 8px; mso-line-height-rule: exactly; width: 20%;">&nbsp;</td>
            <td width="20%" style="background-color: #8877b0; height: 8px; line-height: 8px; font-size: 8px; mso-line-height-rule: exactly; width: 20%;">&nbsp;</td>
        </tr>
    </table>
    
    <!-- Section 2: Greeting Message -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #ffffff; padding: 50px 20px;">
        <tr>
            <td align="center">
                <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width: 600px;">
                    <tr>
                        <td align="center" style="padding-bottom: 20px;">
                            <h2 style="font-family: 'Urbanist', Arial, sans-serif; font-size: 42px; font-weight: 800; color: #c55899; margin: 0; padding: 0; line-height: 1.2;">Hi ${customerName || 'Valued Customer'},</h2>
                        </td>
                    </tr>
                    <tr>
                        <td align="center">
                            <p style="font-family: 'Urbanist', Arial, sans-serif; font-size: 24px; font-weight: 400; color: #000000; margin: 0; padding: 0; line-height: 1.5;">Your printable is ready! 🎉 Can't wait for you to start using it — thank you for supporting 7 Days of Play.</p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
    
    <!-- Section 3: Product Showcase -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #ffffff; padding: 40px 20px;">
        <tr>
            <td align="center">
                <table width="80%" cellpadding="0" cellspacing="0" border="0" class="product-showcase" style="width: 80%; max-width: 900px; background: #63BDE6; border-radius: 30px; overflow: hidden;">
                    <tr>
                        <td style="padding: 35px 25px;">
                            <table width="100%" cellpadding="0" cellspacing="0" border="0">
                                <tr>
                                    <!-- Left Column: Product Image -->
                                    <td class="product-image" width="45%" valign="middle" style=" padding-right: 15px;">
                                        <img src="${imageUrl}" alt="${productTitle}" style="margin: 0 auto; width: 100%; max-width: 250px; display: block; height: auto; border-radius: 20px;" />
                                    </td>
                                    <!-- Right Column: Product Info -->
                                    <td class="product-info" width="55%" valign="middle" align="center" style="padding-left: 15px;">
                                        <table cellpadding="0" cellspacing="0" border="0" width="100%">
                                            <tr>
                                                <td align="center" style="padding-bottom: 12px;">
                                                    <h3 style="font-family: 'Urbanist', Arial, sans-serif; font-size: 32px; font-weight: 800; color: #ffffff; margin: 0; padding: 0; line-height: 1.2; text-align: center;">${productTitle}</h3>
                                                </td>
                                            </tr>
                                            <tr>
                                                <td align="center" style="padding-bottom: 20px;">
                                                    <p class="product-description" style="font-family: 'Urbanist', Arial, sans-serif; font-size: 15px; font-weight: 400; color: #ffffff; margin: 0; padding: 0 5px; line-height: 1.4; opacity: 0.95; text-align: center;">High-quality digital content, ready for instant download</p>
                                                </td>
                                            </tr>
                                            <tr>
                                                <td align="center" style="text-align: center;">
                                                    <!--[if mso]>
                                                    <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${downloadUrl}" style="height:50px;v-text-anchor:middle;width:200px;" arcsize="20%" stroke="f" fillcolor="#e7635c">
                                                    <w:anchorlock/>
                                                    <center>
                                                    <![endif]-->
                                                    <a href="${downloadUrl}" class="button primary-button button-arrow" style="font-family: 'Urbanist', Arial, sans-serif; display: inline-block; text-decoration: none; text-align: center;">
                                                        <table cellpadding="0" cellspacing="0" border="0" style="margin: 0 auto;">
                                                            <tr>
                                                                <td align="center" style="text-align: center;">
                                                                    <img src="https://cdn.shopify.com/s/files/1/0931/6453/6129/files/image-removebg-preview_4.png?v=1762176633" alt="Download" width="20" height="20" style="display: inline-block; vertical-align: middle; margin-right: 8px;" />
                                                                    <span style="font-size: 20px; font-weight: 700; vertical-align: middle; color:#fff">Download Now</span>
                                                                </td>
                                                            </tr>
                                                        </table>
                                                    </a>
                                                    <!--[if mso]>
                                                    </center>
                                                    </v:roundrect>
                                                    <![endif]-->
                                                </td>
                                            </tr>
                                        </table>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
    
    <!-- Section 4: What's Included & Need Help -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #ffffff; padding: 50px 20px;">
        <tr>
            <td align="center">
                <table width="75%" cellpadding="0" cellspacing="0" border="0" class="info-section" style="width: 75%; max-width: 850px;">
                    <tr>
                        <!-- Left Column: What's Included -->
                        <td class="info-column" width="48%" valign="top" style="padding: 0 20px 0 0;">
                            <h3 style="font-family: 'Urbanist', Arial, sans-serif; font-size: 32px; font-weight: 800; color: #c55899; margin: 0 0 20px 0; padding: 0;">What's Included:</h3>
                            <ul style="font-family: 'Urbanist', Arial, sans-serif; font-size: 18px; color: #000000; margin: 0; padding: 0 0 0 20px; line-height: 1.8;">
                                <li style="margin-bottom: 10px;">Instant download access</li>
                                <li style="margin-bottom: 10px;">High-quality PDF format</li>
                                <li style="margin-bottom: 10px;">Access anytime through your account or this email</li>
                                <li style="margin-bottom: 10px;">Mobile and desktop compatible</li>
                            </ul>
                            <!-- Horizontal Divider (Mobile only - shows between sections) -->
                            <table class="divider-horizontal" width="100%" cellpadding="0" cellspacing="0" border="0" style="display: none; margin: 30px 0;">
                                <tr>
                                    <td style="border-top: 3px solid #c55899;"></td>
                                </tr>
                            </table>
                        </td>
                        
                        <!-- Vertical Divider (Desktop only) -->
                        <td class="divider-vertical" width="4%" style="border-left: 3px solid #c55899; height: 200px;"></td>
                        
                        <!-- Right Column: Need Help -->
                        <td class="info-column" width="48%" valign="top" style="padding: 0 0 0 20px;">
                            <h3 style="font-family: 'Urbanist', Arial, sans-serif; font-size: 32px; font-weight: 800; color: #c55899; margin: 0 0 20px 0; padding: 0;">Need Help?</h3>
                            <p style="font-family: 'Urbanist', Arial, sans-serif; font-size: 18px; color: #000000; margin: 0; padding: 0; line-height: 1.7;">If you have any questions or issues with your download, please don't hesitate to contact our support team.</p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
    
    <!-- Colorful Border -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0" class="color-border" role="presentation" style="width: 100%; min-width: 100%; table-layout: fixed;">
        <tr>
            <td width="20%" style="background-color: #7bbae0; height: 8px; line-height: 8px; font-size: 8px; mso-line-height-rule: exactly; width: 20%;">&nbsp;</td>
            <td width="20%" style="background-color: #e4a947; height: 8px; line-height: 8px; font-size: 8px; mso-line-height-rule: exactly; width: 20%;">&nbsp;</td>
            <td width="20%" style="background-color: #c55899; height: 8px; line-height: 8px; font-size: 8px; mso-line-height-rule: exactly; width: 20%;">&nbsp;</td>
            <td width="20%" style="background-color: #d86b61; height: 8px; line-height: 8px; font-size: 8px; mso-line-height-rule: exactly; width: 20%;">&nbsp;</td>
            <td width="20%" style="background-color: #8877b0; height: 8px; line-height: 8px; font-size: 8px; mso-line-height-rule: exactly; width: 20%;">&nbsp;</td>
        </tr>
    </table>
    
    <!-- Section 5: All-Access Pass CTA -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #ffffff; padding: 50px 20px;">
        <tr>
            <td align="center">
                <table width="80%" cellpadding="0" cellspacing="0" border="0" class="cta-section" style="width: 80%; max-width: 900px; background: #C5579A; border-radius: 40px; padding: 50px 40px;">
                    <tr>
                        <td align="center">
                            <!-- Star Icon -->
                            <table cellpadding="0" cellspacing="0" border="0">
                                <tr>
                                    <td align="center" style="padding-bottom: 30px;">
                                        <img src="https://cdn.shopify.com/s/files/1/0931/6453/6129/files/star-circel.png?v=1755514449" alt="Star" style="width: 80px; height: 80px; display: block;" />
                                    </td>
                                </tr>
                            </table>
                            
                            <!-- Heading -->
                            <table cellpadding="0" cellspacing="0" border="0">
                                <tr>
                                    <td align="center" style="padding-bottom: 20px;">
                                        <h2 style="font-family: 'Urbanist', Arial, sans-serif; font-size: 48px; font-weight: 800; color: #ffffff; margin: 0; padding: 0; line-height: 1.2; text-align: center;">Try the All-Access Pass</h2>
                                    </td>
                                </tr>
                            </table>
                            
                            <!-- Subheading -->
                            <table cellpadding="0" cellspacing="0" border="0" style="max-width: 700px;">
                                <tr>
                                    <td align="center" style="padding-bottom: 10px;">
                                        <p style="font-family: 'Urbanist', Arial, sans-serif; font-size: 22px; font-weight: 400; color: #ffffff; margin: 0; padding: 0; line-height: 1.5; text-align: center;">Love printables like this?<br/>Unlock hundreds of printables with the All-Access Pass!</p>
                                    </td>
                                </tr>
                            </table>
                            
                            <!-- Description -->
                            <table cellpadding="0" cellspacing="0" border="0" style="max-width: 700px;">
                                <tr>
                                    <td align="center" style="padding-bottom: 35px;">
                                        <p class="cta-description" style="font-family: 'Urbanist', Arial, sans-serif; font-size: 18px; font-weight: 400; color: #ffffff; margin: 0; padding: 0; line-height: 1.6; text-align: center; opacity: 0.95;">Enjoy unlimited access to every printable in our library — plus new releases designed to make playtime fun, easy, and educational.</p>
                                    </td>
                                </tr>
                            </table>
                            
                            <!-- CTA Button -->
                            <table cellpadding="0" cellspacing="0" border="0">
                                <tr>
                                    <td align="center">
                                        <!--[if mso]>
                                        <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="https://shop.7daysofplay.com/products/all-access-pass" style="height:60px;v-text-anchor:middle;width:350px;" arcsize="20%" stroke="f" fillcolor="#f5a623">
                                        <w:anchorlock/>
                                        <center>
                                        <![endif]-->
                                        <a href="https://shop.7daysofplay.com/products/all-access-pass" class="button primary-button" style="font-family: 'Urbanist', Arial, sans-serif; background: #eea527; border-color: #ffdca9; text-decoration: none; text-align: center; color: #fff;">
                                            Explore the All-Access Pass
                                        </a>
                                        <!--[if mso]>
                                        </center>
                                        </v:roundrect>
                                        <![endif]-->
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
    
    <!-- Section 6: Product Showcase & Save Email Notice -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #ffffff; padding: 50px 20px;">
        <tr>
            <td align="center">
                <table width="80%" cellpadding="0" cellspacing="0" border="0" class="notice-section" style="width: 80%; max-width: 900px;">
                    <tr>
                        <td align="center">
                            <!-- Product Collage Image -->
                            <table cellpadding="0" cellspacing="0" border="0">
                                <tr>
                                    <td align="center">
                                        <img src="https://cdn.shopify.com/s/files/1/0931/6453/6129/files/Screenshot_2025-11-03_213254.png?v=1762187594" alt="Printables" class="collage-image" style="width: 100%; max-width: 900px; height: auto; display: block;" />
                                    </td>
                                </tr>
                            </table>
                            
                            <!-- Notice Box -->
                            <table cellpadding="0" cellspacing="0" border="0" style="width: 100%;">
                                <tr>
                                    <td align="center" style="background-color: #e4a947; border-radius: 20px; padding: 30px 40px;">
                                        <p class="notice-text" style="font-family: 'Urbanist', Arial, sans-serif; font-size: 28px; font-weight: 600; color: #ffffff; margin: 0; padding: 0; line-height: 1.4; text-align: center;">Important: Save this email to easily re-download your file anytime.</p>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>
  `;
};

// Send download email function
export const sendDownloadEmail = async (customerEmail, customerName, productTitle, downloadUrl, shopDomain, productImageUrl = null) => {
  try {
    const htmlContent = createEmailTemplate(customerName, productTitle, downloadUrl, shopDomain, productImageUrl);
    
    const mailOptions = {
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: customerEmail,
      sender: process.env.SMTP_USER,                         // set sender header to be explicit
      envelope: {
        from: process.env.SMTP_USER,                         // MAIL FROM (Return-Path) — important for SPF alignment
        to: customerEmail,
      },    
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

// Send free starter pack email function
export const sendFreeStarterPackEmail = async (customerEmail) => {
  try {
    const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Your Free Starter Pack</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Urbanist:ital,wght@0,100..900;1,100..900&display=swap');
        * {
            margin: 0;
            padding: 0;
            font-family: 'Urbanist', sans-serif;
        }
        .button {
            border-radius: 10px;
            background: #eea527;
            display: inline-block;
            padding-top: 6px;
            padding: 10px 20px;
            padding-top: 6px;
            color: #fff;
            transition: all 0.25s;
            font-weight: bold;
        }
        .primary-button {
            background-color: #e7635c;
            border-color:rgb(232, 163, 159);
            border-width: 5px;
            border-style: solid;
            text-decoration: none;
        }
        .primary-button:hover {
            background-color: #d5807b;
        }
        .button-arrow {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            white-space: nowrap;
            gap: 15px;
        }
        .button-arrow svg {
            max-width: 25px;
            min-width: 25px;
        }
        @media (min-width: 1501px) {
            .button {
                font-size: 24px;
            }
        }
        @media (max-width: 540px) {
            .button {
                font-size: 18px;
                padding: 5px 10px;
            }
        }
        @media screen and (max-width: 768px) {
            .button-arrow svg {
                max-width: 15px;
                min-width: 15px;
            }
        }
        /* Section 1 - Hero Responsive */
        .hero-section {
            background-image: url(https://cdn.shopify.com/s/files/1/0931/6453/6129/files/Screenshot_2025-10-30_113947.png?v=1761808148);
            background-size: cover;
            background-repeat: no-repeat;
            background-position: center;
        }
        /* Mobile Screens - Gmail Compatible */
        @media only screen and (max-width: 600px), only screen and (max-device-width: 600px) {
            /* Prevent auto-scaling */
            * {
                -webkit-text-size-adjust: none !important;
                -ms-text-size-adjust: none !important;
            }
            
            /* Text sizes - multiple selectors for Gmail */
            h1, h1[style] {
                font-size: 28px !important;
                line-height: 1.3 !important;
            }
            h2, h2[style] {
                font-size: 26px !important;
                line-height: 1.3 !important;
            }
            h3, h3[style] {
                font-size: 24px !important;
                line-height: 1.3 !important;
            }
            p, p[style] {
                font-size: 16px !important;
                line-height: 1.5 !important;
            }
            
            /* Table widths */
            table[width="600"] {
                width: 100% !important;
            }
            
            /* Hero section */
            .hero-section {
                background-image: url(https://cdn.shopify.com/s/files/1/0931/6453/6129/files/Screenshot_2025-11-03_230722.png?v=1762193415) !important;
                background-size: contain !important;
            }
            
            /* Product showcase - Mobile Vertical Layout */
            .product-showcase {
                border-radius: 30px !important;
                width: 95% !important;
                display: block !important;
            }
            .product-showcase tr {
                display: block !important;
                width: 100% !important;
            }
            
            /* Hide desktop image on mobile */
            .product-image {
                display: none !important;
            }
            
            /* Show mobile image row */
            .mobile-image-row {
                display: block !important;
            }
            
            /* Show product info as full width block */
            .product-info {
                display: block !important;
                width: 100% !important;
                padding: 0 !important;
            }
            
            /* Override inner table padding */
            .product-info > table {
                padding: 30px 20px !important;
            }
            
            /* Mobile text styling for product showcase */
            .product-info h2,
            .product-info h2[style] {
                font-size: 36px !important;
                line-height: 1.2 !important;
            }
            
            .product-info p,
            .product-info p[style] {
                font-size: 19px !important;
                line-height: 1.4 !important;
            }
            
            /* Reduce spacing between elements */
            .product-info td[style*="padding-bottom: 20px"] {
                padding-bottom: 15px !important;
            }
            .product-info td[style*="padding-bottom: 35px"] {
                padding-bottom: 25px !important;
            }
            
            /* Mobile button styling for product showcase */
            .product-info .button-arrow span,
            .product-info span[style] {
                font-size: 20px !important;
            }
            
            .product-info .button-arrow img {
                width: 20px !important;
                height: 20px !important;
            }
            
            /* Footer Section */
            .footer-section {
                width: 95% !important;
            }
            .footer-section h3 {
                font-size: 24px !important;
                line-height: 1.3 !important;
            }
            .social-icons-table {
                display: block !important;
                width: 100% !important;
            }
            .social-icon-cell {
                display: inline-block !important;
                padding: 0 6px !important;
            }
            .social-icon-circle {
                width: 50px !important;
                height: 50px !important;
                line-height: 50px !important;
            }
            .social-icon-img {
                width: 25px !important;
                height: 25px !important;
            }
            
            /* Product description - more specific */
            .product-description, 
            .product-description[style],
            td .product-description {
                font-size: 15px !important;
                padding: 0 10px !important;
                line-height: 1.4 !important;
            }
            
            /* Button text - more specific */
            .button-arrow span,
            .button-arrow span[style],
            a span[style*="font-size"] {
                font-size: 18px !important;
            }
            
            /* Button icon */
            .button-arrow img {
                width: 18px !important;
                height: 18px !important;
            }
            
            /* Section 4 - Info columns */
            .info-section {
                width: 100% !important;
            }
            .info-column {
                display: block !important;
                width: 100% !important;
                padding: 0 !important;
                margin-bottom: 0 !important;
            }
            .divider-vertical {
                display: none !important;
            }
            .divider-horizontal {
                display: table !important;
                width: 100% !important;
            }
            
            /* Adjust list font size */
            ul, ul li {
                font-size: 16px !important;
            }
            
            /* Section 5 - CTA */
            .cta-section {
                width: 95% !important;
                padding: 40px 25px !important;
                border-radius: 25px !important;
            }
            .cta-description {
                font-size: 16px !important;
            }
            .cta-button {
                font-size: 20px !important;
                padding: 15px 35px !important;
            }
            
            /* Section 6 - Notice */
            .notice-section {
                width: 95% !important;
            }
            .collage-image {
                max-width: 100% !important;
            }
            .notice-text {
                font-size: 20px !important;
            }
            table[style*="background-color: #e4a947"] {
                padding: 20px 25px !important;
                border-radius: 15px !important;
            }
            /* Reduce outer padding for Section 6 */
            table[style*="padding: 50px 20px"]:last-of-type {
                padding: 30px 15px !important;
            }
            
            /* Colorful Border - Force Full Width on Mobile */
            .color-border {
                width: 100% !important;
                min-width: 100% !important;
            }
            .color-border td {
                display: table-cell !important;
                width: 20% !important;
                min-width: 20% !important;
            }
            .product-showcase-section{
                padding: 30px 5px !important;
            }
            .product-info table{
                width: 100% !important;
            }
            .product-info-heading{
                display: block !important;
            }
            .product-info-description{
                display: block !important;
            }
            .product-info-button{
                display: block !important;
            }
        }
    </style>
</head>
<body>
    <!-- Section 1: Hero - Download Ready -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0" class="hero-section" style="background-color: #ffffff; padding: 60px 20px;">
        <tr>
            <td align="center">
                <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width: 600px;">
                    <tr>
                        <td align="center" style="padding-bottom: 20px;">
                            <img src="https://cdn.shopify.com/s/files/1/0931/6453/6129/files/E_Website_About_Page_7DP_2_2_copy-04.jpg?v=1761755674" alt="Download Ready" style="width: 100px; height: 100px; display: block;" />
                        </td>
                    </tr>
                    <tr>
                        <td align="center">
                            <img src="https://cdn.shopify.com/s/files/1/0931/6453/6129/files/7DaysofPlay_LogoV_940_2.png?v=1753886883" alt="7 Days of Play" style="width: 400px; max-width: 100%; height: auto; display: block;" />
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
    
    <!-- Colorful Border -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0" class="color-border" role="presentation" style="width: 100%; min-width: 100%; table-layout: fixed;">
        <tr>
            <td width="20%" style="background-color: #7bbae0; height: 8px; line-height: 8px; font-size: 8px; mso-line-height-rule: exactly; width: 20%;">&nbsp;</td>
            <td width="20%" style="background-color: #e4a947; height: 8px; line-height: 8px; font-size: 8px; mso-line-height-rule: exactly; width: 20%;">&nbsp;</td>
            <td width="20%" style="background-color: #c55899; height: 8px; line-height: 8px; font-size: 8px; mso-line-height-rule: exactly; width: 20%;">&nbsp;</td>
            <td width="20%" style="background-color: #d86b61; height: 8px; line-height: 8px; font-size: 8px; mso-line-height-rule: exactly; width: 20%;">&nbsp;</td>
            <td width="20%" style="background-color: #8877b0; height: 8px; line-height: 8px; font-size: 8px; mso-line-height-rule: exactly; width: 20%;">&nbsp;</td>
        </tr>
    </table>
    
    <!-- Section 3: Product Showcase -->
    <table width="100%" class="product-showcase-section" cellpadding="0" cellspacing="0" border="0" style="background-color: #ffffff; padding: 40px 20px;">
        <tr>
            <td align="center">
                <table width="80%" cellpadding="0" cellspacing="0" border="0" class="product-showcase" style="width: 80%; max-width: 1000px; background: #63BDE6; border-radius: 30px; overflow: hidden;">
                    <!-- Desktop: Image Left, Info Right (using tr with two tds) -->
                    <!-- Mobile: Image Bottom, Info Top (using CSS) -->
                    <tr>
                        <!-- Left Column: Product Image (Full Height, No Padding) -->
                        <td class="product-image" width="45%" valign="top" style="padding: 0;">
                            <img src="https://cdn.shopify.com/s/files/1/0931/6453/6129/files/Untitled-10-02.png?v=1757350146" alt="Free Starter Pack" style="width: 100%; height: 100%; display: block; object-fit: cover; border-radius: 30px 0 0 30px;" />
                        </td>
                        <!-- Right Column: Product Info -->
                        <td class="product-info" width="55%" valign="middle" align="center" style="padding: 50px 40px;">
                            <table cellpadding="0" cellspacing="0" border="0" width="100%">
                                <tr>
                                    <td align="center" class="product-info-heading" style="padding-bottom: 20px;">
                                        <h2 style="font-family: 'Urbanist', Arial, sans-serif; font-size: 56px; font-weight: 700; color: #ffffff; margin: 0; padding: 0; line-height: 1.2; text-align: center;">Hi there,</h2>
                                    </td>
                                </tr>
                                <tr>
                                    <td align="center" class="product-info-description" style="padding-bottom: 35px;">
                                        <p style="font-family: 'Urbanist', Arial, sans-serif; font-size: 22px; font-weight: 400; color: #ffffff; margin: 0; padding: 0; line-height: 1.5; text-align: center;">Thank you for signing up! Your Free Starter Pack is ready to download.</p>
                                    </td>
                                </tr>
                                <tr>
                                    <td align="center" class="product-info-button" style="text-align: center;">
                                        <!--[if mso]>
                                        <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="https://www.dropbox.com/scl/fi/1naztilld4nrytjdumont/Free-Starter-Pack_7DaysofPlay-2.pdf?rlkey=mk9jvd7ddo0s6wc6l2sjpez9t&st=fabe87dm&dl=1" style="height:50px;v-text-anchor:middle;width:200px;" arcsize="20%" stroke="f" fillcolor="#e7635c">
                                        <w:anchorlock/>
                                        <center>
                                        <![endif]-->
                                        <a href="https://www.dropbox.com/scl/fi/1naztilld4nrytjdumont/Free-Starter-Pack_7DaysofPlay-2.pdf?rlkey=mk9jvd7ddo0s6wc6l2sjpez9t&st=fabe87dm&dl=1" class="button primary-button button-arrow" style="font-family: 'Urbanist', Arial, sans-serif; display: inline-block; text-decoration: none; text-align: center;">
                                            <table cellpadding="0" cellspacing="0" border="0" style="margin: 0 auto;">
                                                <tr>
                                                    <td align="center" style="text-align: center;">
                                                        <img src="https://cdn.shopify.com/s/files/1/0931/6453/6129/files/image-removebg-preview_4.png?v=1762176633" alt="Download" width="22" height="22" style="display: inline-block; vertical-align: middle; margin-right: 10px;" />
                                                        <span style="font-size: 22px; font-weight: 700; vertical-align: middle; color:#fff">Download Now</span>
                                                    </td>
                                                </tr>
                                            </table>
                                        </a>
                                        <!--[if mso]>
                                        </center>
                                        </v:roundrect>
                                        <![endif]-->
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                    <!-- Mobile-Only: Image Row (displays below info on mobile) -->
                    <tr class="mobile-image-row" style="display: none;">
                        <td width="100%" style="padding: 0;">
                            <img src="https://cdn.shopify.com/s/files/1/0931/6453/6129/files/Untitled-10-02.png?v=1757350146" alt="Free Starter Pack" style="width: 100%; height: auto; display: block; border-radius: 0 0 30px 30px;" />
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
    
    
    <!-- Section 5: All-Access Pass CTA -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #ffffff; padding: 50px 20px;">
        <tr>
            <td align="center">
                <table width="80%" cellpadding="0" cellspacing="0" border="0" class="cta-section" style="width: 80%; max-width: 900px; background: #C5579A; border-radius: 40px; padding: 50px 40px;">
                    <tr>
                        <td align="center">
                            <!-- Star Icon -->
                            <table cellpadding="0" cellspacing="0" border="0">
                                <tr>
                                    <td align="center" style="padding-bottom: 30px;">
                                        <img src="https://cdn.shopify.com/s/files/1/0931/6453/6129/files/star-circel.png?v=1755514449" alt="Star" style="width: 80px; height: 80px; display: block;" />
                                    </td>
                                </tr>
                            </table>
                            
                            <!-- Heading -->
                            <table cellpadding="0" cellspacing="0" border="0">
                                <tr>
                                    <td align="center" style="padding-bottom: 20px;">
                                        <h2 style="font-family: 'Urbanist', Arial, sans-serif; font-size: 48px; font-weight: 800; color: #ffffff; margin: 0; padding: 0; line-height: 1.2; text-align: center;">Try the All-Access Pass</h2>
                                    </td>
                                </tr>
                            </table>
                            
                            <!-- Subheading -->
                            <table cellpadding="0" cellspacing="0" border="0" style="max-width: 700px;">
                                <tr>
                                    <td align="center" style="padding-bottom: 10px;">
                                        <p style="font-family: 'Urbanist', Arial, sans-serif; font-size: 22px; font-weight: 400; color: #ffffff; margin: 0; padding: 0; line-height: 1.5; text-align: center;">Love printables like this?<br/>Unlock hundreds of printables with the 7 Days of Play All-Access Pass!</p>
                                    </td>
                                </tr>
                            </table>
                            
                            <!-- Description -->
                            <table cellpadding="0" cellspacing="0" border="0" style="max-width: 700px;">
                                <tr>
                                    <td align="center" style="padding-bottom: 35px;">
                                        <p class="cta-description" style="font-family: 'Urbanist', Arial, sans-serif; font-size: 18px; font-weight: 400; color: #ffffff; margin: 0; padding: 0; line-height: 1.6; text-align: center; opacity: 0.95;">Enjoy unlimited access to every printable in our library — plus new releases designed to make playtime fun, easy, and educational.</p>
                                    </td>
                                </tr>
                            </table>
                            
                            <!-- CTA Button -->
                            <table cellpadding="0" cellspacing="0" border="0">
                                <tr>
                                    <td align="center">
                                        <!--[if mso]>
                                        <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="https://shop.7daysofplay.com/products/all-access-pass" style="height:60px;v-text-anchor:middle;width:350px;" arcsize="20%" stroke="f" fillcolor="#f5a623">
                                        <w:anchorlock/>
                                        <center>
                                        <![endif]-->
                                        <a href="https://shop.7daysofplay.com/products/all-access-pass" class="button primary-button" style="font-family: 'Urbanist', Arial, sans-serif; background: #eea527; border-color: #ffdca9; text-decoration: none; text-align: center; color: #fff;">
                                            Explore the All-Access Pass
                                        </a>
                                        <!--[if mso]>
                                        </center>
                                        </v:roundrect>
                                        <![endif]-->
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
    
    <!-- Section 6: Product Showcase & Signature -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #ffffff; padding: 50px 20px 60px;">
        <tr>
            <td align="center">
                <table width="80%" cellpadding="0" cellspacing="0" border="0" class="signature-section" style="width: 80%; max-width: 900px;">
                    <!-- Product Collage Image -->
                    <tr>
                        <td align="center" style="padding-bottom: 40px;">
                            <img src="https://cdn.shopify.com/s/files/1/0931/6453/6129/files/Screenshot_2025-11-04_140800.png?v=1762247301" alt="7 Days of Play Printables" class="collage-image" style="width: 100%; max-width: 900px; height: auto; display: block;" />
                        </td>
                    </tr>
                    
                    <!-- Welcome Message -->
                    <tr>
                        <td align="center" style="padding-bottom: 40px;">
                            <p style="font-family: 'Urbanist', Arial, sans-serif; font-size: 28px; font-weight: 400; color: #000000; margin: 0; padding: 0 20px; line-height: 1.5; text-align: center;">We're excited to have you part of the 7 Days of Play community — where play and learning come together.</p>
                        </td>
                    </tr>
                    
                    <!-- Playfully Text -->
                    <tr>
                        <td align="center" style="padding-bottom: 20px;">
                            <p style="font-family: 'Urbanist', Arial, sans-serif; font-size: 24px; font-weight: 400; color: #000000; margin: 0; padding: 0; text-align: center;">Playfully,</p>
                        </td>
                    </tr>
                    
                    <!-- Signature Image -->
                    <tr>
                        <td align="center" style="padding-bottom: 10px;">
                            <img src="https://cdn.shopify.com/s/files/1/0931/6453/6129/files/E_Website_About_Page_7DP_2_2_copy-09.jpg?v=1761755674" alt="Michelle Signature" class="signature-image" style="width: 200px; max-width: 80%; height: auto; display: block; margin: 0 auto;" />
                        </td>
                    </tr>
                    
                    <!-- Creator Title -->
                    <tr>
                        <td align="center">
                            <p style="font-family: 'Urbanist', Arial, sans-serif; font-size: 22px; font-weight: 400; color: #000000; margin: 0; padding: 0; text-align: center;">Creator of 7 Days of Play</p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
    
    <!-- Colorful Border -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0" class="color-border" role="presentation" style="width: 100%; min-width: 100%; table-layout: fixed;">
        <tr>
            <td width="20%" style="background-color: #7bbae0; height: 8px; line-height: 8px; font-size: 8px; mso-line-height-rule: exactly; width: 20%;">&nbsp;</td>
            <td width="20%" style="background-color: #e4a947; height: 8px; line-height: 8px; font-size: 8px; mso-line-height-rule: exactly; width: 20%;">&nbsp;</td>
            <td width="20%" style="background-color: #c55899; height: 8px; line-height: 8px; font-size: 8px; mso-line-height-rule: exactly; width: 20%;">&nbsp;</td>
            <td width="20%" style="background-color: #d86b61; height: 8px; line-height: 8px; font-size: 8px; mso-line-height-rule: exactly; width: 20%;">&nbsp;</td>
            <td width="20%" style="background-color: #8877b0; height: 8px; line-height: 8px; font-size: 8px; mso-line-height-rule: exactly; width: 20%;">&nbsp;</td>
        </tr>
    </table>
    
    <!-- Footer: Social Media -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #ffffff; padding: 50px 20px;">
        <tr>
            <td align="center">
                <table width="80%" cellpadding="0" cellspacing="0" border="0" class="footer-section" style="width: 80%; max-width: 800px;">
                    <!-- Follow Us Text -->
                    <tr>
                        <td align="center" style="padding-bottom: 30px;">
                            <h3 style="font-family: 'Urbanist', Arial, sans-serif; font-size: 32px; font-weight: 600; color: #000000; margin: 0; padding: 0; text-align: center;">Follow Us @7daysofplay for Activity Ideas</h3>
                        </td>
                    </tr>
                    
                    <!-- Social Media Icons -->
                    <tr>
                        <td align="center">
                            <table cellpadding="0" cellspacing="0" border="0" class="social-icons-table" style="display: inline-block;">
                                <tr>
                                    <!-- Instagram -->
                                    <td align="center" class="social-icon-cell" style="padding: 0 8px;">
                                        <a href="https://instagram.com/7daysofplay" target="_blank" style="text-decoration: none;">
                                            <table cellpadding="0" cellspacing="0" border="0">
                                                <tr>
                                                    <td align="center" class="social-icon-circle" style="background-color: #63BDE6; border-radius: 50%; width: 60px; height: 60px; text-align: center; line-height: 60px;">
                                                        <img src="https://cdn.shopify.com/s/files/1/0931/6453/6129/files/insta.png?v=1762256655" alt="Instagram" class="social-icon-img" width="30" height="30" style="display: inline-block; vertical-align: middle;" />
                                                    </td>
                                                </tr>
                                            </table>
                                        </a>
                                    </td>
                                    
                                    <!-- TikTok -->
                                    <td align="center" class="social-icon-cell" style="padding: 0 8px;">
                                        <a href="https://www.tiktok.com/@7daysofplay" target="_blank" style="text-decoration: none;">
                                            <table cellpadding="0" cellspacing="0" border="0">
                                                <tr>
                                                    <td align="center" class="social-icon-circle" style="background-color: #63BDE6; border-radius: 50%; width: 60px; height: 60px; text-align: center; line-height: 60px;">
                                                        <img src="https://cdn.shopify.com/s/files/1/0931/6453/6129/files/tiktok_3.png?v=1762256654" alt="TikTok" class="social-icon-img" width="30" height="30" style="display: inline-block; vertical-align: middle;" />
                                                    </td>
                                                </tr>
                                            </table>
                                        </a>
                                    </td>
                                    
                                    <!-- Facebook -->
                                    <td align="center" class="social-icon-cell" style="padding: 0 8px;">
                                        <a href="https://facebook.com/7daysofplay" target="_blank" style="text-decoration: none;">
                                            <table cellpadding="0" cellspacing="0" border="0">
                                                <tr>
                                                    <td align="center" class="social-icon-circle" style="background-color: #63BDE6; border-radius: 50%; width: 60px; height: 60px; text-align: center; line-height: 60px;">
                                                        <img src="https://cdn.shopify.com/s/files/1/0931/6453/6129/files/facebook_1.png?v=1762256654" alt="Facebook" class="social-icon-img" width="30" height="30" style="display: inline-block; vertical-align: middle;" />
                                                    </td>
                                                </tr>
                                            </table>
                                        </a>
                                    </td>
                                    
                                    <!-- Snapchat -->
                                    <td align="center" class="social-icon-cell" style="padding: 0 8px;">
                                        <a href="https://www.snapchat.com/@sevendaysofplay" target="_blank" style="text-decoration: none;">
                                            <table cellpadding="0" cellspacing="0" border="0">
                                                <tr>
                                                    <td align="center" class="social-icon-circle" style="background-color: #63BDE6; border-radius: 50%; width: 60px; height: 60px; text-align: center; line-height: 60px;">
                                                        <img src="https://cdn.shopify.com/s/files/1/0931/6453/6129/files/snapchat.png?v=1762256654" alt="Snapchat" class="social-icon-img" width="30" height="30" style="display: inline-block; vertical-align: middle;" />
                                                    </td>
                                                </tr>
                                            </table>
                                        </a>
                                    </td>
                                    
                                    <!-- YouTube -->
                                    <td align="center" class="social-icon-cell" style="padding: 0 8px;">
                                        <a href="https://youtube.com/7daysofplayshorts" target="_blank" style="text-decoration: none;">
                                            <table cellpadding="0" cellspacing="0" border="0">
                                                <tr>
                                                    <td align="center" class="social-icon-circle" style="background-color: #63BDE6; border-radius: 50%; width: 60px; height: 60px; text-align: center; line-height: 60px;">
                                                        <img src="https://cdn.shopify.com/s/files/1/0931/6453/6129/files/youtube.png?v=1762256654" alt="YouTube" class="social-icon-img" width="30" height="30" style="display: inline-block; vertical-align: middle;" />
                                                    </td>
                                                </tr>
                                            </table>
                                        </a>
                                    </td>
                                    
                                    <!-- Pinterest -->
                                    <td align="center" class="social-icon-cell" style="padding: 0 8px;">
                                        <a href="https://pinterest.com/7daysofplay" target="_blank" style="text-decoration: none;">
                                            <table cellpadding="0" cellspacing="0" border="0">
                                                <tr>
                                                    <td align="center" class="social-icon-circle" style="background-color: #63BDE6; border-radius: 50%; width: 60px; height: 60px; text-align: center; line-height: 60px;">
                                                        <img src="https://cdn.shopify.com/s/files/1/0931/6453/6129/files/pinterest.png?v=1762256655" alt="Pinterest" class="social-icon-img" width="30" height="30" style="display: inline-block; vertical-align: middle;" />
                                                    </td>
                                                </tr>
                                            </table>
                                        </a>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>
    `;

    const textContent = `Hi there,

Thank you for signing up! Your Free Starter Pack is ready to download.

Download Link: https://www.dropbox.com/scl/fi/1naztilld4nrytjdumont/Free-Starter-Pack_7DaysofPlay-2.pdf?rlkey=mk9jvd7ddo0s6wc6l2sjpez9t&st=fabe87dm&dl=1

We're excited to have you part of the 7 Days of Play community — where play and learning come together.

Playfully,
Michelle
Creator of 7 Days of Play

Follow Us @7daysofplay for Activity Ideas`;

    const mailOptions = {
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: customerEmail,
      sender: process.env.SMTP_USER,
      envelope: {
        from: process.env.SMTP_USER,
        to: customerEmail,
      },    
      subject: `🎉 Your Free Starter Pack is Ready!`,
      html: htmlContent,
      text: textContent
    };

    const result = await transporter.sendMail(mailOptions);
    console.log('Free starter pack email sent successfully:', result.messageId);
    return { success: true, messageId: result.messageId };
  } catch (error) {
    console.error('Error sending free starter pack email:', error);
    return { success: false, error: error.message };
  }
};

export default { sendDownloadEmail, sendFreeStarterPackEmail };
