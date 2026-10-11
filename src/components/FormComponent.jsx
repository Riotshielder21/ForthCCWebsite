import React, { useState } from 'react';
import { Send, CheckCircle, AlertCircle } from 'lucide-react';
import { apiUrl } from '../utils/api';

const EMPTY = { name: '', email: '', category: '', notes: '' };

// Each form (or category within a form) has preset questions; answers are sent as "Question: answer" items.
export default function FormComponent({
  title = 'Submit a Form',
  description = 'Fill in the details below to submit your form.',
  categories = [],
  categoryLabel = 'Category',
  questions = {},
  submitLabel = 'Submit',
  endpoint = '/api/forms',
  onSuccess,
}) {
  const [formData, setFormData] = useState(EMPTY);
  const [answers, setAnswers] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState(null);

  const activeQuestions = Array.isArray(questions) ? questions : (questions[formData.category] || []);

  const handleInputChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (field === 'category') setAnswers({});
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setSubmitStatus(null);

    try {
      const items = activeQuestions
        .map((question, index) => ({ question, answer: (answers[index] || '').trim() }))
        .filter(({ answer }) => answer)
        .map(({ question, answer }) => `${question.label}: ${answer}`);
      if (items.length === 0) throw new Error('Please answer the questions.');

      const response = await fetch(apiUrl(endpoint), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...formData,
          items
        }),
      });

      const result = await response.json();

      if (response.ok) {
        let message = 'Submitted successfully!';

        if (onSuccess) {
          message = onSuccess(result, formData) || message;
        }

        setSubmitStatus({
          type: 'success',
          message,
          discountCode: result.discountCode,
          verified: result.verification?.verified
        });

        setFormData(EMPTY);
        setAnswers({});
      } else {
        throw new Error(result.error || 'Failed to submit');
      }
    } catch (error) {
      setSubmitStatus({ type: 'error', message: error.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="FormContainer">
          <div className="SpaceB8">
        <h2 className="form_heading_bold">
          {title}
        </h2>
        <p className="FormDescription">
          {description}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="FormBody">
        <div className="FormFieldGrid">
          <div>
            <label className="FormLabel">
              Your Name *
            </label>
            <input
              type="text"
              required
              value={formData.name}
              onChange={(e) => handleInputChange('name', e.target.value)}
              className="FormInput"
              placeholder="John Doe"
            />
          </div>
          <div>
            <label className="FormLabel">
              Email Address *
            </label>
            <input
              type="email"
              required
              value={formData.email}
              onChange={(e) => handleInputChange('email', e.target.value)}
              className="FormInput"
              placeholder="john@example.com"
            />
          </div>
        </div>

        {categories.length > 0 && (
          <div>
            <label className="FormLabel">
              {categoryLabel} *
            </label>
            <select
              required
              value={formData.category}
              onChange={(e) => handleInputChange('category', e.target.value)}
              className="FormInput"
            >
              <option value="">Select...</option>
              {categories.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>
        )}

        {activeQuestions.map((question, index) => (
          <div key={`${formData.category}-${index}`}>
            <label className="FormLabel">{question.label} *</label>
            {question.multiline ? (
              <textarea rows={3} required value={answers[index] || ''} onChange={(e) => setAnswers(prev => ({ ...prev, [index]: e.target.value }))} className="FormInput" placeholder={question.placeholder} />
            ) : (
              <input type="text" required value={answers[index] || ''} onChange={(e) => setAnswers(prev => ({ ...prev, [index]: e.target.value }))} className="FormInput" placeholder={question.placeholder} />
            )}
          </div>
        ))}

        <div>
            <label className="FormLabel">
            Additional Notes
          </label>
          <textarea
            value={formData.notes}
            onChange={(e) => handleInputChange('notes', e.target.value)}
            rows={3}
              className="FormInput"
            placeholder="Any additional information..."
          />
        </div>

        {submitStatus && (
          <div className={`FormAlert ${
            submitStatus.type === 'success'
              ? 'AlertSuccess'
              : 'AlertError'
          }`}>
            <div className="FormAlertInner">
              {submitStatus.type === 'success' ? (
                <CheckCircle className="IconLg FormAlertIcon" />
              ) : (
                <AlertCircle className="IconLg FormAlertIcon" />
              )}
              <div className="FormAlertBody">
                <p className="FormAlertMessage">{submitStatus.message}</p>
                {submitStatus.discountCode && (
                  <div className="DiscountCodeBox">
                    <p className="DiscountCodeTitle">
                      Your Discount Code
                    </p>
                    <p className="DiscountCodeValue">
                      {submitStatus.discountCode}
                    </p>
                    <p className="DiscountCodeHint">
                      Use this code at checkout for 25% off your next purchase
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        <button
          type="submit"
          disabled={isSubmitting}
          className="FormSubmitButton"
        >
          {isSubmitting ? (
            <>
              <div className="FormSpinner" />
              Submitting...
            </>
          ) : (
            <>
              <Send className="IconMd" />
              {submitLabel}
            </>
          )}
        </button>
      </form>
    </div>
  );
}
