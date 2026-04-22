import React, { useState } from 'react';
import { Plus, X, Send, CheckCircle, AlertCircle } from 'lucide-react';

export default function FormComponent({
  title = 'Submit a Form',
  description = 'Fill in the details below to submit your form.',
  categories = [],
  categoryLabel = 'Category',
  itemsLabel = 'Items',
  itemPlaceholder = 'Item',
  submitLabel = 'Submit',
  endpoint = '/api/forms',
  onSuccess,
}) {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    category: '',
    items: [''],
    notes: ''
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState(null);

  const handleInputChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleItemChange = (index, value) => {
    const newItems = [...formData.items];
    newItems[index] = value;
    setFormData(prev => ({ ...prev, items: newItems }));
  };

  const addItem = () => {
    setFormData(prev => ({ ...prev, items: [...prev.items, ''] }));
  };

  const removeItem = (index) => {
    if (formData.items.length > 1) {
      const newItems = formData.items.filter((_, i) => i !== index);
      setFormData(prev => ({ ...prev, items: newItems }));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setSubmitStatus(null);

    try {
      const filteredItems = formData.items.filter(item => item.trim() !== '');

      if (filteredItems.length === 0) {
        throw new Error(`Please add at least one ${itemPlaceholder.toLowerCase()}`);
      }

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...formData,
          items: filteredItems
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

        setFormData({
          name: '',
          email: '',
          category: '',
          items: [''],
          notes: ''
        });
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
        <h2 className="FormTitle">
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

        <div>
          <label className="FormLabel">
            {itemsLabel} *
          </label>
          <div className="FormItemList">
            {formData.items.map((item, index) => (
              <div key={index} className="FormItemRow">
                <input
                  type="text"
                  value={item}
                  onChange={(e) => handleItemChange(index, e.target.value)}
                  className="FormInputFlex FormInput"
                  placeholder={`${itemPlaceholder} ${index + 1}`}
                />
                {formData.items.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeItem(index)}
                    className="FormRemoveButton"
                  >
                    <X className="IconLg" />
                  </button>
                )}
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={addItem}
            className="FormAddButton"
          >
            <Plus className="IconMd" />
            Add Another {itemPlaceholder}
          </button>
        </div>

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
